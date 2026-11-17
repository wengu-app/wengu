import { expect, test } from "@playwright/test";
import { closeImportDialog, fixture, launch, newProfile, useTestSettings } from "./launch.ts";

test("a committed review and its undo survive immediate SIGKILL", async () => {
  const profile = newProfile();
  let app = await launch({ userDataDir: profile });
  await useTestSettings(app.page);
  await app.close();
  app = await launch({ userDataDir: profile, args: [fixture("full-latest.apkg")] });
  await expect(app.page.getByTestId("import-summary")).toBeVisible();
  await closeImportDialog(app.page);
  const committed = await app.page.evaluate(async () => {
    const db = (window as unknown as { __wenguDb: {
      study(deck: null): Promise<{ card: { item: { id: number } } }>;
      answer(input: { itemId: number; rating: number; takenMs: number }): Promise<{ counts: unknown }>;
    } }).__wenguDb;
    const s = await db.study(null);
    const after = await db.answer({ itemId: s.card.item.id, rating: 3, takenMs: 2000 });
    return { id: s.card.item.id, counts: after.counts };
  });
  // No intervening DB operation or graceful shutdown to flush a deferred journal header.
  try { process.kill(-app.proc.pid!, "SIGKILL"); }
  catch { app.proc.kill("SIGKILL"); }
  await app.close("none");
  app = await launch({ userDataDir: profile });
  try {
    await expect(app.page.getByTestId("deck-row").first()).toBeVisible();
    const restored = await app.page.evaluate(async () => {
      const db = (window as unknown as { __wenguDb: {
        info(): Promise<{ counts: { reviewLog: number } }>;
        study(deck: null): Promise<{ counts: unknown; undoLabel: string | null }>;
        undo(): Promise<{ itemIds: number[] } | null>;
      } }).__wenguDb;
      const info = await db.info();
      const state = await db.study(null);
      const undo = await db.undo();
      const undone = await db.info();
      return { reviews: info.counts.reviewLog, counts: state.counts, label: state.undoLabel, undo, undone: undone.counts.reviewLog };
    });
    expect(restored.reviews).toBe(62);
    expect(restored.counts).toEqual(committed.counts);
    expect(restored.label).toBe("Answer good");
    expect(restored.undo?.itemIds).toContain(committed.id);
    expect(restored.undone).toBe(61);
  } finally { await app.close(); }
});
