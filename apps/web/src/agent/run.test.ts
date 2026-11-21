import { describe, expect, it } from "vitest";
import { openNodeEngine } from "@wengu/core/node";
import { checkComponentSource } from "@wengu/runtime";

import { agentTag, AgentInputError, runAgentTool, type AgentDb } from "./run.ts";
import { AGENT_TOOLS } from "./tools.ts";

const client = { name: "Claude Code", version: "2.0.0" };

/** The engine's synchronous API, as the async client the app has. */
async function db(): Promise<AgentDb> {
  const e = await openNodeEngine();
  const methods = [
    "deckTree",
    "createDeck",
    "listNoteTypes",
    "createStockNoteType",
    "search",
    "listWeakNotes",
    "getKnowledgePoint",
    "addKnowledgePoints",
    "updateKnowledgePoint",
    "listPresentations",
    "setVisualPresentation",
    "removeVisualPresentation",
  ] as const;
  return Object.fromEntries(methods.map((m) => [m, async (...a: unknown[]) => (e[m] as (...x: unknown[]) => unknown).apply(e, a)])) as unknown as AgentDb;
}

const run = <T = never>(d: AgentDb, tool: string, args: unknown = {}): Promise<T> => runAgentTool(d, tool, args, client).then((o) => o.result as T);

describe("agent tools", () => {
  it("has a schema for every tool", () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual([
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
    for (const t of AGENT_TOOLS) expect(t.inputSchema["type"]).toBe("object");
  });

  it("tags agent notes with a clean name", () => {
    expect(agentTag(client)).toBe("agent::claude-code");
    expect(agentTag({ name: "  a::b c " })).toBe("agent::a-b-c");
    expect(agentTag({ name: "" })).toBe("agent::unknown");
  });

  it("adds notes to a new deck with the stock Basic type, then finds, reads and updates them", async () => {
    const d = await db();
    const out = await runAgentTool(d, "add_notes", { deck: "Bio::Cells", notes: [{ fields: { Front: "Mitochondria?", Back: "Powerhouse" }, tags: ["bio"] }, { fields: ["Ribosome?", "Makes proteins"] }] }, client);
    expect(out.change).toEqual({ kind: "add", count: 2, deck: "Bio::Cells", undoStepId: expect.any(Number) });
    expect(out.structure).toBe(true);
    const r = out.result as { deck: { name: string }; noteType: string; tag: string; added: { id: number; cards: number }[] };
    expect(r).toMatchObject({ deck: { name: "Bio::Cells" }, noteType: "Basic", tag: "agent::claude-code" });
    expect(r.added.map((a) => a.cards)).toEqual([1, 1]);

    const decks: { name: string; cards: number }[] = await run(d, "list_decks");
    expect(decks.find((x) => x.name === "Bio::Cells")?.cards).toBe(2);
    expect(decks.find((x) => x.name === "Bio")?.cards).toBe(2);

    const found: { total: number; notes: { id: number; first: string; tags: string[]; decks: string[] }[] } = await run(d, "search_notes", { text: "mitochondria", deck: "Bio" });
    expect(found.total).toBe(1);
    expect(found.notes[0]).toMatchObject({ first: "Mitochondria?", tags: ["bio", "agent::claude-code"], decks: ["Bio::Cells"] });
    expect((await run<{ total: number }>(d, "search_notes", { tags: ["agent::claude-code"] })).total).toBe(2);

    const id = found.notes[0]!.id;
    await runAgentTool(d, "update_note", { id, fields: { back: "Makes ATP" } }, client);
    const note: { fields: Record<string, string>; cards: { deck: string; state: string; due: string }[] } = await run(d, "get_note", { id });
    expect(note.fields).toEqual({ Front: "Mitochondria?", Back: "Makes ATP" });
    expect(note.cards).toEqual([expect.objectContaining({ deck: "Bio::Cells", state: "new", due: "new" })]);
  });

  it("makes cloze notes and reversed cards", async () => {
    const d = await db();
    const cloze = await run<{ added: { cards: number }[] }>(d, "add_notes", { deck: "Default", noteType: "Cloze", notes: [{ fields: { Text: "{{c1::Paris}} is the capital of {{c2::France}}" } }] });
    expect(cloze.added[0]!.cards).toBe(2);
    const rev = await run<{ added: { cards: number }[] }>(d, "add_notes", { deck: "Default", noteType: "basic (and reversed card)", notes: [{ fields: ["hund", "dog"] }] });
    expect(rev.added[0]!.cards).toBe(2);
    const types: { name: string; fields: string[] }[] = await run(d, "list_note_types");
    expect(types.map((t) => t.name).sort()).toEqual(["Basic (and reversed card)", "Cloze"]);
  });

  it("rejects bad input with a message the agent can act on, adding nothing", async () => {
    const d = await db();
    await expect(runAgentTool(d, "add_notes", { deck: "X", notes: [{ fields: { Front: "a", Back: "b" } }, { fields: { Question: "?" } }] }, client)).rejects.toThrow(
      /notes\[1\]: "Basic" has no field "Question"; its fields are Front, Back/,
    );
    await expect(runAgentTool(d, "add_notes", { deck: "X", notes: [{ fields: { Front: "a" } }, { fields: { Back: "only back" } }] }, client)).rejects.toThrow(
      /knowledge point 2: .*no review items/,
    );
    expect((await run<{ total: number }>(d, "search_notes")).total).toBe(0);
    await expect(runAgentTool(d, "add_notes", { deck: "X", noteType: "Nope", notes: [{ fields: ["a"] }] }, client)).rejects.toBeInstanceOf(AgentInputError);
    await expect(runAgentTool(d, "search_notes", { deck: "Missing" }, client)).rejects.toThrow(/no deck named "Missing"/);
    await expect(runAgentTool(d, "get_note", { id: 42 }, client)).rejects.toThrow(/no note 42/);
    await expect(runAgentTool(d, "nope", {}, client)).rejects.toThrow(/unknown tool/);
  });

  it("validates component sources statically and infers three library dependency", () => {
    const syntaxBad = checkComponentSource("export function mount( {");
    expect(syntaxBad.ok).toBe(false);
    expect(syntaxBad.findings.map((f) => f.code)).toContain("syntax-error");

    const noMount = checkComponentSource("export const x = 1;");
    expect(noMount.ok).toBe(false);
    expect(noMount.findings.map((f) => f.code)).toContain("no-mount-export");

    const blocked = checkComponentSource(
      "export function mount() { fetch('https://x'); localStorage.getItem('k'); location = 'https://evil'; }",
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.findings.filter((f) => f.code === "blocked-api")).toHaveLength(3);

    const badImport = checkComponentSource("import foo from 'unknown-pkg'; export function mount() {}");
    expect(badImport.ok).toBe(false);
    expect(badImport.findings.map((f) => f.code)).toContain("import-not-allowed");

    const goodThree = checkComponentSource(`
      import * as THREE from 'three';
      import { createCardShell } from 'wengu/card';
      import { createScene3D } from 'wengu/scene3d';
      export function mount(root, ctx) {
        const s = createCardShell(root, ctx);
        createScene3D(s.stage, ctx);
        ctx.onPhaseChange(() => {});
        void THREE;
      }
    `);
    expect(goodThree.ok).toBe(true);
    expect(goodThree.inferredLibraries).toEqual(["three"]);
    expect(goodThree.findings).toEqual([]);
  });

  it("supports set_visual_card (dryRun + upsert), get_note(includeSource), remove_visual_card, and list_weak_notes", async () => {
    const d = await db();
    const added = await run<{ added: { id: number }[] }>(d, "add_notes", {
      deck: "Chem::Orbitals",
      notes: [{ fields: ["3d_z2 shape", "Lobes along z + torus in xy"], tags: ["leech"] }],
    });
    const noteId = added.added[0]!.id;

    // 1. Rejects blocked API / illegal import / syntax error without writing anything.
    await expect(
      runAgentTool(d, "set_visual_card", { noteId, source: "export function mount() { fetch('http://evil'); }" }, client),
    ).rejects.toThrow(/blocked-api/);
    await expect(
      runAgentTool(d, "set_visual_card", { noteId, source: "import x from 'not-allowed'; export function mount() {}" }, client),
    ).rejects.toThrow(/import-not-allowed/);
    expect((await run<{ visualCards: unknown[] }>(d, "get_note", { id: noteId })).visualCards).toEqual([]);

    const goodSource = `
      import * as THREE from 'three';
      import { createCardShell } from 'wengu/card';
      import { createScene3D } from 'wengu/scene3d';
      export function mount(root, ctx) {
        const shell = createCardShell(root, ctx, { height: 420, prompt: 'Orbital?' });
        const scene = createScene3D(shell.stage, ctx, { height: 420 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
        scene.scene.add(mesh);
        ctx.onPhaseChange((p) => { if (p === 'reveal') shell.showFeedback({ title: '3d_z2' }); });
      }
    `;

    // 2. dryRun validates & infers libraries without persisting.
    const dry = await run<{ dryRun: boolean; verified: boolean; libraries: string[] }>(d, "set_visual_card", {
      noteId,
      title: "3d_z2 Visual",
      source: goodSource,
      dryRun: true,
    });
    expect(dry).toMatchObject({ dryRun: true, verified: true, libraries: ["three"] });
    expect((await run<{ visualCards: unknown[] }>(d, "get_note", { id: noteId })).visualCards).toEqual([]);

    // 3. Before attaching: list_weak_notes returns noteId with hasVisual: false.
    const weakBefore = await run<{ total: number; notes: Array<{ id: number; hasVisual: boolean; isLeech: boolean }> }>(
      d,
      "list_weak_notes",
      { hasVisual: false },
    );
    expect(weakBefore.notes).toEqual([expect.objectContaining({ id: noteId, hasVisual: false, isLeech: true })]);

    // 4. Write & upsert visual card.
    const firstSave = await runAgentTool(
      d,
      "set_visual_card",
      { noteId, title: "3d_z2 Visual", source: goodSource, props: { axis: "z" } },
      client,
    );
    expect(firstSave.result).toMatchObject({
      noteId,
      replaced: false,
      verified: true,
      libraries: ["three"],
    });
    expect(firstSave.change).toMatchObject({ kind: "visual-set", noteId, title: "3d_z2 Visual", replaced: false });

    const noteWithSrc = await run<{ visualCards: Array<{ title: string; source?: string; props?: Record<string, unknown> }> }>(
      d,
      "get_note",
      { id: noteId, includeSource: true },
    );
    expect(noteWithSrc.visualCards).toHaveLength(1);
    expect(noteWithSrc.visualCards[0]).toMatchObject({
      title: "3d_z2 Visual",
      source: goodSource,
      props: { axis: "z" },
    });

    const weakAfter = await run<{ notes: Array<{ id: number; hasVisual: boolean }> }>(d, "list_weak_notes", {
      deck: "Chem",
    });
    expect(weakAfter.notes).toEqual([expect.objectContaining({ id: noteId, hasVisual: true })]);
    expect((await run<{ notes: unknown[] }>(d, "list_weak_notes", { hasVisual: false })).notes).toEqual([]);

    // 5. Remove visual card.
    const removed = await runAgentTool(d, "remove_visual_card", { noteId }, client);
    expect(removed.result).toEqual({ removed: 1 });
    expect(removed.change).toEqual({ kind: "visual-remove", noteId, count: 1 });
    expect((await run<{ visualCards: unknown[] }>(d, "get_note", { id: noteId })).visualCards).toEqual([]);
  });
});
