import { DatabaseSync } from "node:sqlite";

export const db = new DatabaseSync(process.env.DB_PATH ?? "data.db");

db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY, customer TEXT, status TEXT, eta TEXT
);
CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY, name TEXT, keywords TEXT, price_ngn INTEGER, in_stock INTEGER
);
CREATE TABLE IF NOT EXISTS conversations (
  phone TEXT PRIMARY KEY, awaiting TEXT, attempts INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open', updated_at TEXT
);
CREATE TABLE IF NOT EXISTS seen_messages (wa_message_id TEXT PRIMARY KEY, received_at TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, wa_message_id TEXT,
  phone TEXT, event TEXT NOT NULL, intent TEXT, confidence REAL, detail TEXT
);
CREATE TABLE IF NOT EXISTS notify_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, message TEXT, attempts INTEGER DEFAULT 0, sent INTEGER DEFAULT 0
);
`);

// Synthetic seed data only (fictional shop: "Zuri Gadgets & Wears")
const seedOrders = db.prepare("INSERT OR IGNORE INTO orders VALUES (?,?,?,?)");
seedOrders.run("ORD-1001", "Ada (fictional)", "Out for delivery", "Today, by 5pm");
seedOrders.run("ORD-1002", "Tunde (fictional)", "Processing", "2 working days");
seedOrders.run("ORD-1003", "Ngozi (fictional)", "Delivered", "Delivered yesterday");

const seedProducts = db.prepare("INSERT OR IGNORE INTO products VALUES (?,?,?,?,?)");
seedProducts.run("P-01", "Ankara Maxi Dress", "ankara,dress,maxi", 18500, 1);
seedProducts.run("P-02", "Wireless Earbuds", "earbuds,earphones,airpods", 22000, 1);
seedProducts.run("P-03", "10000mAh Power Bank", "power bank,powerbank,charger", 15000, 0);

export const now = () => new Date().toISOString();

export function audit(e: {
  wa_message_id?: string; phone?: string; event: string;
  intent?: string; confidence?: number; detail?: string;
}): number {
  const r = db.prepare(
    "INSERT INTO audit_log (ts, wa_message_id, phone, event, intent, confidence, detail) VALUES (?,?,?,?,?,?,?)"
  ).run(now(), e.wa_message_id ?? null, e.phone ?? null, e.event, e.intent ?? null, e.confidence ?? null, e.detail ?? null);
  return Number(r.lastInsertRowid);
}
