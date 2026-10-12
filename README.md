AIL Lead Systems & Automation Engineer Assessment (Version 1.1)
Candidate: Emmanuel Seun Shittu
Chosen context: Retail and order enquiries (fictional shop "Zuri Gadgets & Wears")

WHAT IS WHERE
  01_Written_Submission.pdf   Items A, B, E, F, G, H as labelled sections (source: 01_Written_Submission.md)
  02_Prototype/               Node.js + TypeScript webhook service with SQLite audit log and dashboard
    src/                      db, classifier, handler (flow logic), notifier, server, run-tests
    public/index.html         operations dashboard
    test_inputs/              synthetic WhatsApp-style payloads (one per scenario)
  03_Test_Record.md           expected vs actual for every intent, the escalation and the failure conditions
  04_Demo_Video_Link.txt      link to the  minute demonstration video
  README.txt                  this file

REQUIREMENTS
  Node.js >= 22.13 (uses the built-in node:sqlite module; no native dependencies)
  Expected on start: Node prints "SQLite is an experimental feature and might change at any time". This is a Node
  warning about node:sqlite, not an error. I chose it to avoid native build dependencies for an easy reviewer setup;
  for production I would use better-sqlite3 or managed Postgres (see Section F, risk 9).
  Dependencies (see package.json): express ^4.21.2; dev: tsx ^4.19.2, typescript ^5.7.2, @types/express, @types/node

SETUP AND RUN (from the 02_Prototype folder)
  1. npm install
  2. Copy .env.example to .env (Windows: copy .env.example .env; macOS/Linux: cp .env.example .env)
     Set DASHBOARD_PASSWORD and VERIFY_TOKEN. Telegram variables are optional.
  3. npm test        -> runs 13 scenarios on a throwaway database, regenerates 03_Test_Record.md
  4. npm start       -> http://localhost:3000/  (sign in as DASHBOARD_USER, default "manager")
  5. Send a test message. Windows PowerShell:
       curl.exe -X POST localhost:3000/webhook/whatsapp -H "content-type: application/json" -d "@test_inputs/order_status.json"
     macOS/Linux: use curl instead of curl.exe.
  Other inputs: product_enquiry, delivery_info, refund_escalation, unclear_1, unclear_2 (all in test_inputs/).
  Failure path (notifier outage): set NOTIFY_FORCE_FAIL=1 in .env, restart the server, then send
  refund_escalation_2.json. The customer still gets the handover reply, the dashboard shows "Alerts pending 1",
  and the audit log shows notify_failed_queued. Set NOTIFY_FORCE_FAIL=0, restart, and within 60 seconds the
  alert is re-sent (outbox_retry_sent).
  Message IDs are unique per file. To re-run a file, stop the server, delete data.db, and start it again.
  Audit log: curl.exe -u manager:<DASHBOARD_PASSWORD> localhost:3000/api/events  (phone numbers masked)

FULLY WORKING
  Webhook (WhatsApp Cloud API payload shape), rule-based intent classification with confidence, automatic replies,
  order-ID validation with retry, human escalation, staff alerts (case reference, reason and intent only),
  audit log, duplicate-message handling, alert outbox with retry, dashboard with login, automated tests.

SIMULATED
  WhatsApp delivery: inbound messages are posted to the webhook by curl or the test runner, and replies are returned
  in the HTTP response. In production Meta's webhook is pointed at the same endpoint and replies are sent through the
  WhatsApp Cloud API or a provider.
  Staff alerts print to the console unless TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
  Order, product and delivery data are synthetic seed data (src/db.ts). No real personal data is used anywhere.

KNOWN LIMITATIONS
  Keyword classifier (no language understanding; Pidgin and local languages fall to a human).
  Dashboard login is one shared account over HTTP Basic; needs HTTPS and per-person accounts for production.
  Webhook signature verification and an audit-log retention purge are not implemented.
  "Unresolved" counts open conversations per customer, not individual cases.
  Dashboard timestamps are UTC (WAT is UTC+1).
  node:sqlite is experimental in Node; production should use better-sqlite3 or managed Postgres.

NO SECRETS
  No credentials are included. .env and data.db are not part of the package. .env.example contains placeholders only.

TOOLS, AI AND EXTERNAL RESOURCES USED (disclosure under Section 7)
  AI assistant: Claude (Anthropic). Used to help scaffold the TypeScript service, the tests and the dashboard,
  to draft the written sections, to produce the architecture diagram source (Mermaid), and to research current
  WhatsApp Business messaging pricing and the Nigeria Data Protection Act 2023 provisions cited in Sections E and F.
  I remain responsible for every technical decision and every part of this submission, and I will explain, modify
  and debug it in the live stages.
  Libraries and tools: Node.js (built-in node:sqlite), Express, tsx, TypeScript, Mermaid CLI (diagram rendering),
  pandoc and wkhtmltopdf (PDF conversion).
  Templates: none copied from other projects. No proprietary work of a current or former employer or client is included.

HOW THIS DESIGN MAPS TO n8n (not built for this submission; for discussion)
  Express route POST /webhook/whatsapp   -> Webhook trigger node
  Duplicate check (seen_messages)        -> database lookup node + IF node
  classifier.ts                          -> Code node (same keyword scoring)
  Intent branches in handler.ts          -> Switch node, one branch per intent
  Order/product lookups and replies      -> database / HTTP Request nodes
  Escalation + staff alert               -> Telegram node (case reference only)
  audit_log inserts                      -> database insert node on every branch
  Alert outbox + 60s retry               -> Error Trigger workflow + Schedule trigger
