/**
 * End-to-end M2 Step 4 verification:
 *   1. Starts real Wengu desktop app with MCP agent access enabled.
 *   2. Calls real `wengu-mcp` (`add_notes` + `set_visual_card`) for all 4 high-school starter visual cards,
 *      forcing every card through static analysis and offscreen two-phase sandbox verification.
 *   3. Reviews all 4 cards end-to-end in `#/review` (`question` -> `Space` in-place reveal -> rating `4`),
 *      verifying in-place reveal (no iframe reload), SVG step progression, plain-text fallback toggle,
 *      and clean completion.
 *   4. When `WENGU_STARTER_SHOTS=<dir>` is set, captures high-resolution question/reveal screenshots of all 4 cards.
 */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { loadStarterCards, STARTER_DECK } from "../../../examples/visual-cards/manifest.mjs";
import { launch, waitSide, type Running } from "./launch.ts";
import { startMcp } from "./mcp-client.ts";

let app: Running;
test.afterEach(async () => {
  await app?.close();
});

const DETERMINISTIC_VARIANTS: Record<string, Record<string, unknown>> = {
  "geo.solstice": { variant: "summer" },
  "phy.lorentz-force": { variant: "neg-in" },
  "chem.vsepr-angles": { variant: "NH3" },
};

const SHOT_SLUGS: Record<string, string> = {
  "geo.solstice": "01-geo-solstice",
  "bio.action-potential": "02-bio-action-potential",
  "phy.lorentz-force": "03-phy-lorentz-force",
  "chem.vsepr-angles": "04-chem-vsepr",
};

test("starter visual cards pass MCP self-check and complete full two-phase review flow", async () => {
  test.setTimeout(120_000);
  const shotsDir = process.env.WENGU_STARTER_SHOTS;
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });

  app = await launch({
    args: process.platform === "linux" ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [],
  });
  const { page } = app;
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    localStorage.setItem("wengu.debug", "1");
    localStorage.setItem("wengu.settings.v1", JSON.stringify({ lang: "zh", theme: "light" }));
  });
  await page.reload();

  await page.evaluate(() => (location.hash = "#/settings"));
  await page.getByTestId("agent-access").check();
  const config = JSON.parse((await page.getByTestId("agent-config").textContent())!) as {
    mcpServers: { wengu: { command: string; args: string[] } };
  };
  const mcp = await startMcp([config.mcpServers.wengu.command, ...config.mcpServers.wengu.args]);

  const cards = loadStarterCards();
  try {
    const added = await mcp.call("add_notes", {
      deck: STARTER_DECK,
      notes: cards.map((c) => ({ fields: { Front: c.front, Back: c.back }, tags: c.tags })),
    });
    expect(added.isError).toBe(false);
    const addedRows = (added.data as { added: { id: number }[] }).added;
    expect(addedRows).toHaveLength(cards.length);

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]!;
      const noteId = addedRows[i]!.id;
      const saved = await mcp.call("set_visual_card", {
        noteId,
        id: card.id,
        title: card.title,
        libraries: card.libraries,
        sources: card.sources,
        source: card.source,
        props: DETERMINISTIC_VARIANTS[card.id] ?? card.defaultProps,
      });
      expect(saved.isError, `set_visual_card failed for ${card.id}: ${saved.text}`).toBe(false);
      expect(saved.data).toMatchObject({ noteId, verified: true, replaced: false });
    }
  } finally {
    await mcp.close();
  }

  await page.evaluate(() => (location.hash = "#/review"));
  if (shotsDir) await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10_000 });

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    await waitSide(page, "question");
    await expect(page.getByTestId("visual-card")).toBeVisible();
    const vFrame = page.frameLocator('[data-testid="visual-card"] iframe');
    await expect(vFrame.locator(".wg-card")).toHaveAttribute("data-phase", "question");
    await page.waitForTimeout(650);

    if (shotsDir) {
      await page.screenshot({ path: path.join(shotsDir, `step4-${SHOT_SLUGS[card.id]}-question.png`) });
    }

    await page.keyboard.press("Space");
    await waitSide(page, "answer");
    await expect(vFrame.locator(".wg-card")).toHaveAttribute("data-phase", "reveal");
    await page.waitForTimeout(550);

    if (card.id === "bio.action-potential") {
      await expect(vFrame.locator(".wg-steps-counter")).toHaveText("2 / 3");
      await expect(vFrame.locator(".wg-card-feedback.show")).toBeVisible();
    } else if (card.id === "chem.vsepr-angles") {
      await expect(vFrame.locator(".chem-compare")).toBeVisible();
      await expect(vFrame.locator(".chem-col.is-active")).toContainText("NH₃");
    } else {
      await expect(vFrame.locator(".wg-card-feedback.show")).toBeVisible();
    }

    if (shotsDir) {
      await page.screenshot({ path: path.join(shotsDir, `step4-${SHOT_SLUGS[card.id]}-reveal.png`) });
    }

    // Verify lossless plain-text fallback toggle on the first card.
    if (i === 0) {
      await page.getByTestId("visual-toggle").click();
      await expect(page.getByTestId("visual-card")).toHaveCount(0);
      await expect(page.getByTestId("card-frame")).not.toHaveClass(/is-hidden/);
      await page.getByTestId("visual-toggle").click();
      await expect(page.getByTestId("visual-card")).toBeVisible();
      await expect(vFrame.locator(".wg-card")).toHaveAttribute("data-phase", "reveal");
    }

    await page.keyboard.press("Digit4");
  }

  await expect(page.getByTestId("done")).toBeVisible();
});
