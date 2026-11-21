import { expect, test } from "@playwright/test";

import { cardFrame, openApp, waitSide } from "./helpers.ts";

const VISUAL_SOURCE = `
import * as THREE from 'three';
import { createCardShell, pickVariant } from 'wengu/card';
import { createScene3D } from 'wengu/scene3d';

export function mount(root, ctx) {
  const token = Math.random().toString(36).slice(2, 10);
  document.documentElement.dataset.mountToken = token;
  document.documentElement.dataset.mountCount = String(Number(document.documentElement.dataset.mountCount || '0') + 1);

  const axis = pickVariant(['z-axis', 'z-axis'], 'stable-seed');
  const shell = createCardShell(root, ctx, {
    height: 440,
    prompt: 'Which d orbital aligns along the ' + axis + '?',
    subtitle: 'Drag to inspect 3D lobes · Press Space to reveal',
    hint: 'Click lobe or press Space',
  });
  shell.root.tabIndex = 0;

  const s3d = createScene3D(shell.stage, ctx, {
    height: 440,
    cameraPosition: [0, 1.4, 4.4],
    autoRotate: false,
  });

  const mat = new THREE.MeshStandardMaterial({
    color: ctx.theme.tokens.color.accent,
    roughness: 0.35,
    metalness: 0.1,
  });
  const torusMat = new THREE.MeshStandardMaterial({
    color: ctx.theme.tokens.color.categorical[1] ?? '#d9822b',
    roughness: 0.4,
  });
  const lobeGeo = new THREE.SphereGeometry(0.65, 24, 18);
  const topLobe = new THREE.Mesh(lobeGeo, mat);
  topLobe.position.y = 0.72;
  topLobe.scale.set(0.75, 1.15, 0.75);
  const botLobe = new THREE.Mesh(lobeGeo, mat);
  botLobe.position.y = -0.72;
  botLobe.scale.set(0.75, 1.15, 0.75);
  const ringGeo = new THREE.TorusGeometry(0.62, 0.14, 16, 40);
  const ring = new THREE.Mesh(ringGeo, torusMat);
  ring.rotation.x = Math.PI / 2;
  s3d.scene.add(topLobe, botLobe, ring);

  const label = s3d.addLabel('3d_{z^2} orbital', [0, 1.55, 0], {
    visible: ctx.phase === 'reveal',
  });

  s3d.enablePicking(() => [topLobe, botLobe, ring], {
    onClick: (hit) => {
      if (hit) ctx.requestReveal();
    },
  });

  const sync = (phase) => {
    const revealed = phase === 'reveal';
    label.setVisible(revealed);
    label.setHighlighted(revealed);
    if (revealed) {
      s3d.focusCamera([0.9, 1.6, 3.6], [0, 0.1, 0], 180);
      shell.showFeedback({
        title: '3d_z2 orbital',
        body: 'Two axial lobes along +/-z with a toroidal belly in the xy-plane.',
        tone: 'success',
      });
    } else {
      shell.hideFeedback();
    }
  };
  sync(ctx.phase);
  ctx.onPhaseChange(sync);

  return () => {
    lobeGeo.dispose();
    ringGeo.dispose();
    mat.dispose();
    torusMat.dispose();
  };
}
`;

test("visual card: two-phase in-place reveal, forwarded shortcuts, text fallback toggle, and undo", async ({ page }) => {
  await openApp(page, { lang: "en", theme: "light" });
  await expect(page.getByTestId("welcome")).toBeVisible();

  await page.evaluate(async (source) => {
    const db = window.__wenguDb!;
    const deckId = await db.createDeck("Orbitals 3D");
    const nts = await db.listNoteTypes();
    const ntId = nts.find((n) => n.name === "Basic")?.id ?? (await db.createStockNoteType("basic"));
    const added = await db.addKnowledgePoint({
      noteTypeId: ntId,
      deckId,
      fields: ["Which d orbital aligns along the z-axis with a torus?", "The 3d_z2 orbital"],
      tags: ["chemistry", "orbital"],
    });
    await db.setVisualPresentation({
      kpId: added.id,
      manifest: {
        id: "chem.orbital-3dz2",
        title: "3d_z2 Orbital",
        apiVersion: 1,
        libraries: ["three"],
        knowledgePoints: ["chem.orbital-3dz2"],
        sources: [{ title: "Atkins Physical Chemistry" }],
        modes: ["review"],
      },
      source,
      props: { axis: "z" },
    });
  }, VISUAL_SOURCE);

  await page.goto("./#/review");
  await waitSide(page, "question");

  const visualCard = page.getByTestId("visual-card");
  await expect(visualCard).toBeVisible();
  await expect(page.getByTestId("card-frame")).toHaveClass(/is-hidden/);
  await expect(page.getByTestId("mode-chip")).toHaveCount(0);

  const vFrame = page.frameLocator('[data-testid="visual-card"] iframe');
  await expect(vFrame.locator(".wg-card")).toHaveAttribute("data-phase", "question");
  const label = vFrame.locator(".wg-scene3d-label", { hasText: "3d_{z^2} orbital" });
  await expect(label).toHaveClass(/hidden/);
  const initialToken = await vFrame.locator("html").getAttribute("data-mount-token");
  expect(initialToken).toBeTruthy();

  // Focus inside the sandboxed visual iframe (corner avoids picking meshes) and press Space:
  // shortcut forwards to host and reveals in place.
  await vFrame.locator(".wg-card").click({ position: { x: 12, y: 12 } });
  await page.keyboard.press("Space");
  await waitSide(page, "answer");

  await expect(vFrame.locator(".wg-card")).toHaveAttribute("data-phase", "reveal");
  await expect(label).not.toHaveClass(/hidden/);
  await expect(label).toHaveClass(/highlighted/);
  await expect(vFrame.locator(".wg-card-feedback.show")).toBeVisible();
  // In-place reveal did not remount the component or reload the iframe.
  expect(await vFrame.locator("html").getAttribute("data-mount-token")).toBe(initialToken);
  expect(await vFrame.locator("html").getAttribute("data-mount-count")).toBe("1");
  await expect(page.getByTestId("rate-good")).toBeVisible();

  // Toggle to lossless plain-text fallback view and back.
  await page.getByTestId("visual-toggle").click();
  await expect(visualCard).toHaveCount(0);
  await expect(page.getByTestId("card-frame")).not.toHaveClass(/is-hidden/);
  await expect(cardFrame(page).locator("#qa")).toContainText("The 3d_z2 orbital");
  await expect(page.getByTestId("mode-chip")).toBeVisible();

  await page.getByTestId("visual-toggle").click();
  await expect(visualCard).toBeVisible();
  await expect(vFrame.locator(".wg-card")).toHaveAttribute("data-phase", "reveal");

  // Focus inside visual card iframe and press '3' (Good): enters 10m learning step within learn-ahead,
  // returning as the current card cleanly reset to question phase.
  await vFrame.locator(".wg-card").click({ position: { x: 12, y: 12 } });
  await page.keyboard.press("Digit3");
  await waitSide(page, "question");
  await expect(page.getByTestId("review-counts").locator(".c-learn")).toHaveText("1");
  await expect(vFrame.locator(".wg-card")).toHaveAttribute("data-phase", "question");
  expect(await vFrame.locator("html").getAttribute("data-mount-token")).not.toBe(initialToken);

  // Reveal again via forwarded Space, then graduate immediately with '4' (Easy).
  await vFrame.locator(".wg-card").click({ position: { x: 12, y: 12 } });
  await page.keyboard.press("Space");
  await waitSide(page, "answer");
  await vFrame.locator(".wg-card").click({ position: { x: 12, y: 12 } });
  await page.keyboard.press("Digit4");
  await expect(page.getByTestId("done")).toBeVisible();

  // Press 'z' to undo the answer and verify visual card comes back cleanly.
  await page.keyboard.press("z");
  await waitSide(page, "question");
  await expect(page.getByTestId("visual-card")).toBeVisible();
});
