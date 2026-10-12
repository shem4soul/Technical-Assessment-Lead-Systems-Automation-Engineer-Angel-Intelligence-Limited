import express from "express";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { handleMessage } from "./handler.js";
import { db } from "./db.js";
import { retryOutbox } from "./notifier.js";

const app = express();
const publicDir = fileURLToPath(new URL("../public", import.meta.url));
app.use(express.json());

// WhatsApp Cloud API webhook verification (GET). In production Meta calls this once.
app.get("/webhook/whatsapp", (req, res) => {
  const ok = req.query["hub.verify_token"] === (process.env.VERIFY_TOKEN ?? "dev-token");
  res.status(ok ? 200 : 403).send(ok ? String(req.query["hub.challenge"]) : "forbidden");
});

// Incoming messages (POST). Payload shape mirrors WhatsApp Cloud API so production = point Meta here.
app.post("/webhook/whatsapp", async (req, res) => {
  const msgs = req.body?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];
  const results = [];
  for (const m of msgs) {
    if (m.type !== "text") continue;
    results.push(await handleMessage({ wa_message_id: m.id, phone: m.from, text: m.text?.body ?? "" }));
  }
  res.status(200).json({ results }); // always 200 so Meta doesn't retry-storm
});


// ---- Access control: dashboard and /api/* require HTTP Basic auth. The webhook stays open
// (Meta must reach it); its protection is VERIFY_TOKEN on setup and, in production, signature checks.
const USER = process.env.DASHBOARD_USER ?? "manager";
const PASS = process.env.DASHBOARD_PASSWORD ?? "";
if (!PASS) {
  if (process.env.NODE_ENV === "production") { console.error("DASHBOARD_PASSWORD is required in production"); process.exit(1); }
  console.warn("WARNING: DASHBOARD_PASSWORD not set. Dashboard is OPEN (development only).");
}
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!PASS) return next();
  const [u, ...rest] = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString().split(":");
  if (same(u ?? "", USER) && same(rest.join(":"), PASS)) return next();
  res.set("WWW-Authenticate", 'Basic realm="Ops dashboard"').status(401).send("Authentication required");
}
const maskPhone = (p: string | null) => (p && p.length > 7 ? `${p.slice(0, 4)}****${p.slice(-3)}` : p);

app.use(requireAuth);
app.use(express.static(publicDir));

app.get("/api/stats", (_req, res) => {
  const one = (q: string) => (db.prepare(q).get() as { n: number }).n;
  const byIntent = db.prepare(
    "SELECT intent, COUNT(*) AS n FROM audit_log WHERE event='classified' GROUP BY intent").all();
  const total = one("SELECT COUNT(*) n FROM audit_log WHERE event='message_received'");
  const escalated = one("SELECT COUNT(*) n FROM audit_log WHERE event='escalated'");
  res.json({
    total_messages: total,
    by_intent: byIntent,
    auto_replied: one("SELECT COUNT(*) n FROM audit_log WHERE event='auto_replied'"),
    escalated,
    escalation_rate: total ? Math.round((escalated / total) * 100) : 0,
    duplicates_ignored: one("SELECT COUNT(*) n FROM audit_log WHERE event='duplicate_ignored'"),
    unresolved_conversations: one("SELECT COUNT(*) n FROM conversations WHERE status IN ('open','escalated')"),
    pending_alerts: one("SELECT COUNT(*) n FROM notify_outbox WHERE sent=0"),
  });
});

app.get("/api/events", (_req, res) => {
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200").all() as { phone: string | null }[];
  res.json(rows.map((r) => ({ ...r, phone: maskPhone(r.phone) })));
});

setInterval(() => retryOutbox().catch(() => {}), 60_000);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Listening on http://localhost:${port}`));
