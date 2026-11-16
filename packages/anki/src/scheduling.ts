import type { AnkiPackage, Card, Deck, DeckConfig } from "./model.js";

export type CardDue =
  | { kind: "position"; position: number }
  | { kind: "timestamp"; unixSeconds: number }
  | { kind: "day"; day: number; /** Unix seconds of the start of that day, assuming the given rollover hour in UTC offset 0. */ approxUnixSeconds: number };

/**
 * Interpret `card.due`.
 *
 * Review and day-learning cards count days from the collection's creation
 * day. A package does not record the user's rollover hour or time zone
 * (verified: neither is in an exported .apkg), so the absolute time is an
 * approximation: crt is the start of the creation day, plus `day` × 24h.
 */
export function cardDue(card: Pick<Card, "due" | "queue" | "type">, crt: number): CardDue {
  switch (card.queue) {
    case 0:
      return { kind: "position", position: card.due };
    case 1:
    case 4:
      return { kind: "timestamp", unixSeconds: card.due };
    case 2:
    case 3:
      return { kind: "day", day: card.due, approxUnixSeconds: crt + card.due * 86400 };
    default:
      // buried / suspended: interpret by card type
      if (card.type === 0) return { kind: "position", position: card.due };
      if (card.type === 1 || card.type === 3) {
        // intraday learning cards keep a timestamp; interday ones a day number
        return card.due > 1_000_000_000
          ? { kind: "timestamp", unixSeconds: card.due }
          : { kind: "day", day: card.due, approxUnixSeconds: crt + card.due * 86400 };
      }
      return { kind: "day", day: card.due, approxUnixSeconds: crt + card.due * 86400 };
  }
}

export interface FsrsParameters {
  /** FSRS generation the parameters belong to. */
  version: 4 | 5 | 6;
  /** The stored parameters (17, 19 or 21 numbers), or null if the preset uses Anki's built-in defaults. */
  params: number[] | null;
  desiredRetention: number;
}

/**
 * The FSRS parameters and desired retention Anki would use for a card in
 * `deck`: newest non-empty parameter set from the deck's preset, and the
 * deck-level retention override if present.
 */
export function fsrsParametersFor(deck: Deck, configs: readonly DeckConfig[]): FsrsParameters | null {
  const conf = configs.find((c) => c.id === deck.configId);
  if (!conf) return null;
  const desiredRetention = deck.desiredRetention ?? conf.desiredRetention;
  if (conf.fsrsParams6.length) return { version: 6, params: conf.fsrsParams6, desiredRetention };
  if (conf.fsrsParams5.length) return { version: 5, params: conf.fsrsParams5, desiredRetention };
  if (conf.fsrsParams4.length) return { version: 4, params: conf.fsrsParams4, desiredRetention };
  return { version: 6, params: null, desiredRetention };
}

/** Lookup helpers for a package. */
export function indexPackage(pkg: AnkiPackage) {
  const notes = new Map(pkg.notes.map((n) => [n.id, n]));
  const notetypes = new Map(pkg.notetypes.map((n) => [n.id, n]));
  const decks = new Map(pkg.decks.map((d) => [d.id, d]));
  const revlogByCard = new Map<number, AnkiPackage["revlog"]>();
  for (const r of pkg.revlog) {
    const l = revlogByCard.get(r.cardId);
    if (l) l.push(r);
    else revlogByCard.set(r.cardId, [r]);
  }
  return { notes, notetypes, decks, revlogByCard };
}
