import { db, audit, now } from "./db.js";

async function send(message: string): Promise<void> {
  if (process.env.NOTIFY_FORCE_FAIL === "1") throw new Error("Simulated notifier outage");
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.log(`[SIMULATED STAFF ALERT] ${message}`); return; }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: message }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
}

// FAILURE PATH #2: if the alert cannot be sent, queue it and log it. Never lose an escalation.
export async function notifyStaff(message: string, ctx: { phone: string; wa_message_id: string }) {
  try {
    await send(message);
    audit({ ...ctx, event: "staff_notified", detail: message });
  } catch (err) {
    db.prepare("INSERT INTO notify_outbox (ts, message) VALUES (?,?)").run(now(), message);
    audit({ ...ctx, event: "notify_failed_queued", detail: String(err) });
  }
}

export async function retryOutbox() {
  const rows = db.prepare("SELECT id, message, attempts FROM notify_outbox WHERE sent=0 AND attempts<5").all() as
    { id: number; message: string; attempts: number }[];
  for (const r of rows) {
    try {
      await send(r.message);
      db.prepare("UPDATE notify_outbox SET sent=1 WHERE id=?").run(r.id);
      audit({ event: "outbox_retry_sent", detail: `outbox#${r.id}` });
    } catch {
      db.prepare("UPDATE notify_outbox SET attempts=attempts+1 WHERE id=?").run(r.id);
    }
  }
}
