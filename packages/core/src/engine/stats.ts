import type { RetentionSample, Stats } from "../types.js";
import type { Engine } from "./engine.js";

export function computeStats(e: Engine, options: { deckId?: number; days?: number }): Stats {
  const t = e.timing();
  const days = Math.min(Math.max(1, Math.trunc(options.days ?? 30)), 3650);
  const decks = options.deckId !== undefined ? e.subtree(options.deckId) : null;
  const deckList = decks ? decks.map((d) => Math.trunc(d)).join(",") || "NULL" : null;
  const itemFilter = deckList ? `AND deck_id IN (${deckList})` : "";
  const revFilter = deckList ? `AND card_id IN (SELECT id FROM review_items WHERE deck_id IN (${deckList}))` : "";

  const today = e.db.get<{ n: number; t: number | null; a: number; h: number; g: number; ez: number; fresh: number }>(
    `SELECT count(*) AS n, sum(taken) AS t, sum(ease = 1) AS a, sum(ease = 2) AS h, sum(ease = 3) AS g, sum(ease = 4) AS ez,
            count(DISTINCT CASE WHEN kind = 0 AND last_ivl = 0 THEN card_id END) AS fresh
     FROM revlog WHERE id >= ? AND ease > 0 ${revFilter}`,
    [t.dayStartMs],
  )!;

  const retention = (sinceMs: number, mature: boolean): RetentionSample => {
    const r = e.db.get<{ p: number | null; f: number | null }>(
      `SELECT sum(ease > 1) AS p, sum(ease = 1) AS f FROM revlog WHERE id >= ? AND kind = 1 AND ease > 0 ${mature ? "AND last_ivl >= 21" : ""} ${revFilter}`,
      [sinceMs],
    )!;
    const passed = Number(r.p ?? 0);
    const failed = Number(r.f ?? 0);
    return { passed, failed, rate: passed + failed ? passed / (passed + failed) : null };
  };
  const dayMs = (n: number) => e.schedulerDays().dayStart(t.today - n);

  const upcoming = new Array<number>(days).fill(0);
  for (const r of e.db.values(
    `SELECT due, count(*) FROM review_items WHERE queue IN (2, 3) AND due < ? ${itemFilter} GROUP BY due`,
    [t.today + days],
  )) {
    const i = Math.max(0, Number(r[0]) - t.today);
    upcoming[i] = upcoming[i]! + Number(r[1]);
  }
  upcoming[0] =
    upcoming[0]! + Number(e.db.value(`SELECT count(*) FROM review_items WHERE queue IN (1, 4) AND due < ? ${itemFilter}`, [Math.floor(t.nextDayAtMs / 1000)]) ?? 0);
  const overdue = Number(e.db.value(`SELECT count(*) FROM review_items WHERE queue IN (2, 3) AND due < ? ${itemFilter}`, [t.today]) ?? 0);

  // By queue only, so the count is answered from the (queue, due) / (deck_id, queue, due) indexes.
  const byQueue = new Map<number, number>();
  for (const r of e.db.values(`SELECT queue, count(*) FROM review_items WHERE 1 ${itemFilter} GROUP BY queue`)) byQueue.set(Number(r[0]), Number(r[1]));
  const q = (...queues: number[]) => queues.reduce((a, k) => a + (byQueue.get(k) ?? 0), 0);
  const totals = { n: q(0), l: q(1, 3, 4), r: q(2), s: q(-1), b: q(-2, -3) };
  const kps = deckList
    ? Number(e.db.value(`SELECT count(DISTINCT kp_id) FROM review_items WHERE deck_id IN (${deckList})`) ?? 0)
    : Number(e.db.value("SELECT count(*) FROM knowledge_points") ?? 0);

  return {
    today: {
      reviews: Number(today.n ?? 0),
      newItems: Number(today.fresh ?? 0),
      byRating: [Number(today.a ?? 0), Number(today.h ?? 0), Number(today.g ?? 0), Number(today.ez ?? 0)],
      timeMs: Number(today.t ?? 0),
    },
    retention: {
      last7Days: retention(dayMs(6), false),
      last30Days: retention(dayMs(29), false),
      mature30Days: retention(dayMs(29), true),
    },
    upcoming,
    overdue,
    totals: {
      new: Number(totals.n ?? 0),
      learning: Number(totals.l ?? 0),
      review: Number(totals.r ?? 0),
      suspended: Number(totals.s ?? 0),
      buried: Number(totals.b ?? 0),
      knowledgePoints: kps,
    },
  };
}
