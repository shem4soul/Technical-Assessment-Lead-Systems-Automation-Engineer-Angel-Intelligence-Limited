import { db, audit, now } from "./db.js";
import { classify, type Intent } from "./classifier.js";
import { notifyStaff } from "./notifier.js";

export interface Incoming { wa_message_id: string; phone: string; text: string }
export interface Result { reply: string | null; intent: Intent; escalated: boolean; duplicate: boolean }

const THRESHOLD = () => Number(process.env.CONFIDENCE_THRESHOLD ?? 0.5);
const ORDER_RE = /ORD-\d{4}/i;
const MAX_ATTEMPTS = 2;

function setConv(phone: string, awaiting: string | null, attempts: number, status = "open") {
  db.prepare(
    `INSERT INTO conversations (phone, awaiting, attempts, status, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(phone) DO UPDATE SET awaiting=excluded.awaiting, attempts=excluded.attempts,
     status=excluded.status, updated_at=excluded.updated_at`
  ).run(phone, awaiting, attempts, status, now());
}

async function escalate(m: Incoming, intent: Intent, confidence: number, why: string): Promise<Result> {
  setConv(m.phone, null, 0, "escalated");
  const id = audit({ ...m, event: "escalated", intent, confidence, detail: why });
  // Data minimisation (NDPA): alerts carry a case reference, reason and intent only.
  // No phone number or message text leaves the system; staff read the case in the dashboard.
  await notifyStaff(`CASE-${id}: ${why}. Intent: ${intent}. Open the dashboard to read the message.`, m);
  return { reply: "Thanks, I've passed this to a team member who will reply shortly.", intent, escalated: true, duplicate: false };
}

export async function handleMessage(m: Incoming): Promise<Result> {
  // FAILURE PATH #1: duplicate delivery (WhatsApp retries webhooks). Ignore but log.
  const seen = db.prepare("SELECT 1 FROM seen_messages WHERE wa_message_id=?").get(m.wa_message_id);
  if (seen) {
    audit({ ...m, event: "duplicate_ignored" });
    return { reply: null, intent: "unknown", escalated: false, duplicate: true };
  }
  db.prepare("INSERT INTO seen_messages VALUES (?,?)").run(m.wa_message_id, now());
  audit({ ...m, event: "message_received", detail: m.text });

  const conv = db.prepare("SELECT awaiting, attempts FROM conversations WHERE phone=?").get(m.phone) as
    { awaiting: string | null; attempts: number } | undefined;

  // Continue a guided flow: we asked for an order ID.
  if (conv?.awaiting === "order_id") {
    const id = m.text.match(ORDER_RE)?.[0].toUpperCase();
    if (!id) {
      const attempts = conv.attempts + 1;
      audit({ ...m, event: "validation_failed", intent: "order_status", detail: `attempt ${attempts}` });
      if (attempts >= MAX_ATTEMPTS) return escalate(m, "order_status", 1, "missing/invalid order ID after 2 tries");
      setConv(m.phone, "order_id", attempts);
      return { reply: "That doesn't look right. Order IDs look like ORD-1001. Please send yours.", intent: "order_status", escalated: false, duplicate: false };
    }
    return orderStatus(m, id);
  }

  const { intent, confidence } = classify(m.text);
  audit({ ...m, event: "classified", intent, confidence });

  // FAILURE PATH #3 (low confidence): ask once, then escalate.
  if (intent === "unknown" || confidence < THRESHOLD()) {
    const attempts = (conv?.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) return escalate(m, intent, confidence, "low-confidence classification");
    setConv(m.phone, null, attempts);
    return { reply: "Sorry, I didn't quite get that. Is it about an order, a product, or delivery?", intent, escalated: false, duplicate: false };
  }

  switch (intent) {
    case "complaint_refund":
      return escalate(m, intent, confidence, "complaint/refund (always human)");
    case "delivery_info":
      return done(m, intent, "Delivery: Benin City (Edo State) 1-2 working days (₦1,500), other states 3-5 days (₦3,500).");
    case "product_enquiry": {
      const rows = db.prepare("SELECT name, keywords, price_ngn, in_stock FROM products").all() as
        { name: string; keywords: string; price_ngn: number; in_stock: number }[];
      const t = m.text.toLowerCase();
      const p = rows.find((r) => r.keywords.split(",").some((k) => t.includes(k)));
      if (!p) return escalate(m, intent, confidence, "product not found in catalogue");
      return done(m, intent, `${p.name}: ₦${p.price_ngn.toLocaleString("en-NG")}, ${p.in_stock ? "in stock" : "currently out of stock"}.`);
    }
    case "order_status": {
      const id = m.text.match(ORDER_RE)?.[0].toUpperCase();
      if (!id) {
        setConv(m.phone, "order_id", 0);
        return { reply: "Sure! Please send your order ID (e.g. ORD-1001).", intent, escalated: false, duplicate: false };
      }
      return orderStatus(m, id);
    }
  }
  return escalate(m, intent, confidence, "unhandled");
}

async function orderStatus(m: Incoming, id: string): Promise<Result> {
  const o = db.prepare("SELECT status, eta FROM orders WHERE order_id=?").get(id) as { status: string; eta: string } | undefined;
  if (!o) return escalate(m, "order_status", 1, `order ${id} not found`);
  return done(m, "order_status", `Order ${id}: ${o.status}. ETA: ${o.eta}.`);
}

function done(m: Incoming, intent: Intent, reply: string): Result {
  setConv(m.phone, null, 0, "resolved");
  audit({ ...m, event: "auto_replied", intent, detail: reply });
  return { reply, intent, escalated: false, duplicate: false };
}
