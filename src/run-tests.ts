// Runs synthetic scenarios against the real handler using a throwaway DB,
// then writes 03_Test_Record.md (expected vs actual).
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dbPath = join(tmpdir(), "ail-test.db");
rmSync(dbPath, { force: true });
process.env.DB_PATH = dbPath;
process.env.NOTIFY_FORCE_FAIL = "0";

const { handleMessage } = await import("./handler.js");
const { db } = await import("./db.js");
const { retryOutbox } = await import("./notifier.js");

type Row = { id: string; covers: string; input: string; expected: string; actual: string; pass: boolean };
const rows: Row[] = [];
let n = 0;
async function t(covers: string, phone: string, wid: string, text: string, expected: string,
  check: (r: Awaited<ReturnType<typeof handleMessage>>) => boolean, show: (r: any) => string) {
  const r = await handleMessage({ wa_message_id: wid, phone, text });
  rows.push({ id: `T${++n}`, covers, input: text, expected, actual: show(r), pass: check(r) });
}
const s = (r: any) => `${r.escalated ? "ESCALATED" : r.duplicate ? "DUPLICATE" : "replied"}: ${r.reply ?? "(none)"}`;

await t("Intent: order status", "2340001", "w1", "Where is my order ORD-1001?", "Reply with status Out for delivery",
  r => !!r.reply?.includes("Out for delivery") && !r.escalated, s);
await t("Intent: order status (guided: asks for ID)", "2340002", "w2", "I want to track my order", "Asks for order ID",
  r => !!r.reply?.includes("order ID") && !r.escalated, s);
await t("Validation: valid ID on follow-up", "2340002", "w3", "ORD-1002", "Reply with status Processing",
  r => !!r.reply?.includes("Processing"), s);
await t("Intent: product enquiry", "2340003", "w4", "How much is the wireless earbuds?", "Price ₦22,000 in stock",
  r => !!r.reply?.includes("22,000") && !!r.reply?.includes("in stock"), s);
await t("Intent: delivery info", "2340004", "w5", "How long is delivery to Benin City?", "Delivery times and fees",
  r => !!r.reply?.includes("Benin City (Edo State) 1-2"), s);
await t("Intent: complaint/refund + HUMAN ESCALATION", "2340005", "w6", "I want a refund, the item was damaged", "Escalated to staff, no automated resolution",
  r => r.escalated, s);
await t("FAILURE 1: duplicate message (same ID)", "2340001", "w1", "Where is my order ORD-1001?", "Ignored, no second reply, logged",
  r => r.duplicate && r.reply === null, s);

await t("FAILURE 2a: low-confidence message, first try", "2340006", "w7", "hmm", "Clarifying question, not escalated",
  r => !r.escalated && !!r.reply?.includes("didn't quite get"), s);
await t("FAILURE 2b: low-confidence message, second try", "2340006", "w8", "ok", "Escalated after 2 tries",
  r => r.escalated, s);

process.env.NOTIFY_FORCE_FAIL = "1";
await t("FAILURE 3: notifier outage during escalation", "2340007", "w9", "This is a scam, give me my money back", "Customer still gets handover reply; alert queued, not lost",
  r => r.escalated, s);
const queued = (db.prepare("SELECT COUNT(*) n FROM notify_outbox WHERE sent=0").get() as any).n;
const logged = (db.prepare("SELECT COUNT(*) n FROM audit_log WHERE event='notify_failed_queued'").get() as any).n;
rows.push({ id: `T${++n}`, covers: "FAILURE 3 evidence: outbox + audit", input: "(db check)", expected: "1 queued alert, 1 notify_failed_queued event",
  actual: `queued=${queued}, logged=${logged}`, pass: queued === 1 && logged === 1 });

process.env.NOTIFY_FORCE_FAIL = "0";
await retryOutbox();
const left = (db.prepare("SELECT COUNT(*) n FROM notify_outbox WHERE sent=0").get() as any).n;
rows.push({ id: `T${++n}`, covers: "Recovery: outbox retry after outage ends", input: "(retryOutbox)", expected: "0 pending alerts",
  actual: `pending=${left}`, pass: left === 0 });

const alerts = [
  ...(db.prepare("SELECT detail FROM audit_log WHERE event='staff_notified'").all() as { detail: string }[]),
  ...(db.prepare("SELECT message AS detail FROM notify_outbox").all() as { detail: string }[]),
];
const leaked = alerts.filter(a => /2340\d{3}|item was damaged|this is a scam|money back/i.test(a.detail));
rows.push({ id: `T${++n}`, covers: "Data minimisation: staff alert has no phone number or message text", input: "(audit check)", expected: "Alerts contain case ref, reason, intent only",
  actual: `alerts=${alerts.length}, leaking=${leaked.length}`, pass: alerts.length >= 3 && leaked.length === 0 });

const md = ["# Test Record", "", `Run: ${new Date().toISOString()} (npm test)`, "",
  "| ID | Covers | Input | Expected | Actual | Result |", "|---|---|---|---|---|---|",
  ...rows.map(r => `| ${r.id} | ${r.covers} | ${r.input.replace(/\|/g, "/")} | ${r.expected} | ${r.actual.replace(/\|/g, "/")} | ${r.pass ? "PASS" : "FAIL"} |`),
  "", `**${rows.filter(r => r.pass).length}/${rows.length} passed**`].join("\n");
writeFileSync(new URL("../../03_Test_Record.md", import.meta.url), md);
console.log(md);
process.exit(rows.every(r => r.pass) ? 0 : 1);
