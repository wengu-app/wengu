import type { CardData } from "@wengu/anki";

/**
 * The card `data` column → CardData, the same parsing as @wengu/anki's reader (`parseCardData` in read.ts,
 * which its package entry does not export yet; switch when it does).
 */
export function cardDataOf(raw: string): CardData {
  const out: CardData = { originalPosition: null, memoryState: null, desiredRetention: null, decay: null, lastReviewTime: null, customData: null, extra: {} };
  if (!raw) return out;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    out.extra["raw"] = raw;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    switch (k) {
      case "pos":
        out.originalPosition = Number(v);
        break;
      case "s":
      case "d":
        break;
      case "dr":
        out.desiredRetention = Number(v);
        break;
      case "decay":
        out.decay = Number(v);
        break;
      case "lrt":
        out.lastReviewTime = Number(v);
        break;
      case "cd":
        out.customData = typeof v === "string" ? v : JSON.stringify(v);
        break;
      default:
        out.extra[k] = v;
    }
  }
  if (typeof obj["s"] === "number" && typeof obj["d"] === "number") out.memoryState = { stability: obj["s"], difficulty: obj["d"] };
  return out;
}

