/**
 * Local agents over MCP: the command shown in Settings starts `wengu-mcp`, which relays tool calls to the running app.
 * Covers access off (no socket), adding notes (visible in the app, with the agent's tag and an undo toast), errors
 * returned to the agent, and the agent list in Settings.
 */
import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

import { lineReader, MAX_LINE } from "../src/agentBridge.ts";
import { launch, useTestSettings, waitSide, type Running } from "./launch.ts";
import { startMcp } from "./mcp-client.ts";

test("agent messages preserve split UTF-8 characters and enforce the byte limit", () => {
  const lines: string[] = [];
  const read = lineReader((line) => lines.push(line));
  const message = Buffer.from("温故\nnext\n");
  expect(read(message.subarray(0, 2))).toBe(true);
  expect(read(message.subarray(2))).toBe(true);
  expect(read(Buffer.alloc(MAX_LINE + 1, 65))).toBe(false);
  const oversized = Buffer.alloc(MAX_LINE + 2, 65);
  oversized[oversized.length - 1] = 10;
  expect(lineReader((line) => lines.push(line))(oversized)).toBe(false);
  expect(lines).toEqual(["温故", "next"]);
});

let app: Running;
test.afterEach(async () => {
  await app?.close();
});

test("an agent adds notes through MCP while access is on", async () => {
  app = await launch();
  const { page } = app;
  await useTestSettings(page);
  await page.evaluate(() => (location.hash = "#/settings"));
  const access = page.getByTestId("agent-access");
  await expect(access).not.toBeChecked();
  await access.check();
  const config = JSON.parse((await page.getByTestId("agent-config").textContent())!) as { mcpServers: { wengu: { command: string; args: string[] } } };
  const command = [config.mcpServers.wengu.command, ...config.mcpServers.wengu.args];
  expect(path.basename(config.mcpServers.wengu.command)).toMatch(/^wengu-mcp(\.exe)?$/);
  expect(command).not.toContain("--mcp");
  expect(command).toContain(`--wengu-profile=${app.userDataDir}`);
  expect(await page.getByTestId("agent-claude-command").textContent()).toMatch(/^claude mcp add --scope user wengu -- /);
  const socket = path.join(app.userDataDir, "agent.sock");
  await expect.poll(() => existsSync(socket)).toBe(true);

  const mcp = await startMcp(command);
  try {
    const tools = (await mcp.request("tools/list")).result!["tools"] as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual([
      "list_decks",
      "list_note_types",
      "search_notes",
      "get_note",
      "create_deck",
      "add_notes",
      "update_note",
      "list_weak_notes",
      "set_visual_card",
      "remove_visual_card",
    ]);

    const added = await mcp.call("add_notes", {
      deck: "Agent::Biology",
      notes: [{ fields: { Front: "What makes ATP?", Back: "Mitochondria" }, tags: ["bio"] }, { fields: { Front: "Where are proteins made?", Back: "Ribosomes" } }],
    });
    expect(added.isError).toBe(false);
    expect(added.data).toMatchObject({ deck: { name: "Agent::Biology" }, noteType: "Basic", tag: "agent::test-agent" });

    // the app shows it at once, and the batch can be undone from the toast
    await expect(page.locator(".toast").filter({ hasText: "Test Agent added 2 notes to Agent::Biology" })).toBeVisible();
    const found = await mcp.call("search_notes", { tags: ["agent::test-agent"] });
    expect(found.data).toMatchObject({ total: 2 });

    // input errors reach the agent; nothing is written
    const bad = await mcp.call("add_notes", { deck: "Agent::Biology", notes: [{ fields: { Question: "?" } }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('"Basic" has no field "Question"; its fields are Front, Back');

    // the agent is listed in Settings
    await page.evaluate(() => (location.hash = "#/decks"));
    await page.evaluate(() => (location.hash = "#/settings"));
    const row = page.getByTestId("agent-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Test Agent");
    await expect(row).toContainText("9.9");
    await expect(row).toContainText("2 notes added");
    await expect(row).toContainText("agent::test-agent");

    // the deck is in the deck list
    await page.evaluate(() => (location.hash = "#/decks"));
    await expect(page.getByText("Biology", { exact: true }).first()).toBeVisible();

    // access off: the socket closes and the agent is told what to do
    await page.evaluate(() => (location.hash = "#/settings"));
    await page.getByTestId("agent-access").uncheck();
    await expect.poll(() => existsSync(socket)).toBe(false);
    const off = await mcp.call("list_decks", {});
    expect(off.isError).toBe(true);
    expect(off.text).toContain("Allow local agents");
  } finally {
    expect(await mcp.close()).toBe(0);
  }
});

test("undo from the toast removes the whole batch", async () => {
  app = await launch();
  const { page } = app;
  await useTestSettings(page);
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.getByTestId("agent-access").check();
  const config = JSON.parse((await page.getByTestId("agent-config").textContent())!) as { mcpServers: { wengu: { command: string; args: string[] } } };
  const mcp = await startMcp([config.mcpServers.wengu.command, ...config.mcpServers.wengu.args]);
  try {
    const notes = Array.from({ length: 5 }, (_, i) => ({ fields: [`front ${i}`, `back ${i}`] }));
    expect((await mcp.call("add_notes", { deck: "Batch", notes })).isError).toBe(false);
    const toast = page.locator(".toast").filter({ hasText: "added 5 notes" });
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => ((await mcp.call("search_notes", { deck: "Batch" })).data as { total: number }).total).toBe(0);
  } finally {
    await mcp.close();
  }
});

const GOOD_SVG_VISUAL = `
import { createCardShell, createStepController } from 'wengu/card';

export function mount(root, ctx) {
  const shell = createCardShell(root, ctx, {
    height: 360,
    prompt: 'Cell membrane selective permeability',
    subtitle: 'Observe step before vs after reveal',
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 360 180');
  svg.style.cssText = 'width:100%;height:100%;display:block;';
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('x', '180');
  label.setAttribute('y', '95');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('fill', ctx.theme.tokens.color.text);
  label.textContent = 'Question state';
  svg.append(label);
  shell.stage.append(svg);

  createStepController(ctx, {
    steps: ['Question state', 'Phospholipid bilayer blocks polar ions'],
    questionStep: 0,
    revealStep: 1,
    onChange: (text) => {
      label.textContent = text;
      if (ctx.phase === 'reveal') {
        shell.showFeedback({ title: 'Revealed', body: text, tone: 'success' });
      } else {
        shell.hideFeedback();
      }
    },
  });
}
`;

test("set_visual_card runs static and offscreen sandbox verification over MCP, renders in review, and can be removed", async () => {
  app = await launch();
  const { page } = app;
  await useTestSettings(page);
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.getByTestId("agent-access").check();
  const config = JSON.parse((await page.getByTestId("agent-config").textContent())!) as {
    mcpServers: { wengu: { command: string; args: string[] } };
  };
  const mcp = await startMcp([config.mcpServers.wengu.command, ...config.mcpServers.wengu.args]);
  try {
    const added = await mcp.call("add_notes", {
      deck: "Bio::Visual",
      notes: [{ fields: { Front: "Membrane permeability?", Back: "Phospholipid bilayer" } }],
    });
    expect(added.isError).toBe(false);
    const noteId = (added.data as { added: { id: number }[] }).added[0]!.id;

    // 1. Blocked API is rejected cleanly by static check with structured diagnostics.
    const bad = await mcp.call("set_visual_card", {
      noteId,
      title: "Bad Visual",
      source: "export function mount() { fetch('https://example.com'); }",
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("blocked-api");

    // 2. Valid card passes static + real offscreen sandbox verification in both phases.
    const saved = await mcp.call("set_visual_card", {
      noteId,
      title: "Membrane Bilayer",
      source: GOOD_SVG_VISUAL,
    });
    expect(saved.isError, saved.text).toBe(false);
    expect(saved.data).toMatchObject({ noteId, verified: true, title: "Membrane Bilayer", replaced: false });
    await expect(page.locator(".toast").filter({ hasText: 'attached visual card “Membrane Bilayer”' })).toBeVisible();

    // 3. Reviewer loads the visual card and flips in place.
    await page.evaluate(() => (location.hash = "#/review"));
    await waitSide(page, "question");
    await expect(page.getByTestId("visual-card")).toBeVisible();
    const vFrame = page.frameLocator('[data-testid="visual-card"] iframe');
    await expect(vFrame.locator(".wg-card")).toHaveAttribute("data-phase", "question");
    await page.keyboard.press("Space");
    await waitSide(page, "answer");
    await expect(vFrame.locator(".wg-card")).toHaveAttribute("data-phase", "reveal");
    await expect(vFrame.locator(".wg-card-feedback.show")).toBeVisible();

    // 4. Remove via MCP leaves the underlying text note ready to study.
    const removed = await mcp.call("remove_visual_card", { noteId });
    expect(removed.isError).toBe(false);
    expect(removed.data).toEqual({ removed: 1 });
    await page.evaluate(() => (location.hash = "#/decks"));
    await page.evaluate(() => (location.hash = "#/review"));
    await waitSide(page, "question");
    await expect(page.getByTestId("visual-card")).toHaveCount(0);
    await expect(page.getByTestId("card-frame")).not.toHaveClass(/is-hidden/);
  } finally {
    await mcp.close();
  }
});
