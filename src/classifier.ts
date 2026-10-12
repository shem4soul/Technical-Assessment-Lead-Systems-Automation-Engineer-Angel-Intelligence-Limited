// Rule-based intent scoring. Deliberately simple, explainable, zero cost.
// Production upgrade path: LLM fallback only when confidence is low.
export type Intent =
  | "order_status" | "product_enquiry" | "delivery_info" | "complaint_refund" | "unknown";

const RULES: Record<Exclude<Intent, "unknown">, string[]> = {
  order_status: ["order", "where is my", "track", "ord-", "status of"],
  product_enquiry: ["price", "how much", "available", "in stock", "do you have", "cost"],
  delivery_info: ["delivery", "deliver", "shipping", "how long", "benin", "edo state", "fee"],
  complaint_refund: ["refund", "complain", "wrong item", "damaged", "fake", "scam", "money back", "angry", "bad"],
};

export function classify(text: string): { intent: Intent; confidence: number } {
  const t = text.toLowerCase();
  const scores = Object.entries(RULES).map(([intent, kws]) => ({
    intent: intent as Intent,
    hits: kws.filter((k) => t.includes(k)).length,
  }));
  scores.sort((a, b) => b.hits - a.hits);
  const [top, second] = scores;
  if (top.hits === 0) return { intent: "unknown", confidence: 0 };
  // Confidence drops when two intents tie (ambiguous message).
  const confidence = top.hits === second.hits ? 0.4 : Math.min(0.5 + 0.25 * top.hits, 0.95);
  return { intent: top.intent, confidence };
}
