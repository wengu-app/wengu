/**
 * Runs agent tool calls (see tools.ts) against the collection. Pure logic over the client API, so it runs the same in
 * the app and in tests (over a Node engine).
 */
import type { DeckNode, Id, ItemDue, NoteType, WenguClient } from "@wengu/core";

import type { AgentClient } from "./tools.ts";

export type AgentDb = Pick<
  WenguClient,
  "deckTree" | "createDeck" | "listNoteTypes" | "createStockNoteType" | "search" | "getKnowledgePoint" | "addKnowledgePoints" | "updateKnowledgePoint"
>;

/** What a call changed, for the app to refresh and tell the user. */
export type AgentChange = { kind: "add"; count: number; deck: string; undoStepId: number } | { kind: "update"; id: Id } | { kind: "deck"; name: string; created: boolean };

export interface AgentOutcome {
  result: unknown;
  change?: AgentChange;
  /** Note types were created (the app reloads its list). */
  structure?: boolean;
}

/** An error the agent can act on (bad input); its message is returned as the tool result. */
export class AgentInputError extends Error {}

const fail = (msg: string): never => {
  throw new AgentInputError(msg);
};

/** The tag every note an agent adds gets: agent::<client name>, lower-case, without spaces or ::. */
export function agentTag(client: AgentClient): string {
  const slug = client.name
    .trim()
    .toLowerCase()
    .replace(/::+/g, "-")
    .replace(/[\s"]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `agent::${slug || "unknown"}`;
}

const STOCK: Record<string, "basic" | "basic-reversed" | "cloze"> = {
  basic: "basic",
  "basic (and reversed card)": "basic-reversed",
  cloze: "cloze",
};

function obj(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) fail("arguments must be an object");
  return args as Record<string, unknown>;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) fail(`${name} must be a non-empty string`);
  return (v as string).trim();
}

function int(v: unknown, name: string): number {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) fail(`${name} must be a non-negative integer`);
  return n as number;
}

function tagList(v: unknown, name: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((t) => typeof t !== "string")) fail(`${name} must be an array of strings`);
  return (v as string[]).flatMap((t) => t.split(/\s+/)).filter(Boolean);
}

function flatDecks(tree: DeckNode[]): DeckNode[] {
  const out: DeckNode[] = [];
  const walk = (ds: DeckNode[]) => {
    for (const d of ds) {
      out.push(d);
      walk(d.children);
    }
  };
  walk(tree);
  return out;
}

async function findDeck(db: AgentDb, ref: unknown, name: string): Promise<DeckNode> {
  const decks = flatDecks(await db.deckTree());
  if (typeof ref === "number" || (typeof ref === "string" && /^\d+$/.test(ref.trim()))) {
    const id = Number(ref);
    const d = decks.find((x) => x.id === id);
    if (d) return d;
  }
  const want = str(ref, name).toLowerCase();
  const d = decks.find((x) => x.name.toLowerCase() === want);
  if (!d) fail(`no deck named "${String(ref)}"; existing decks: ${decks.map((x) => x.name).join(", ") || "none"}`);
  return d!;
}

async function noteTypeFor(db: AgentDb, ref: unknown): Promise<{ nt: NoteType; created: boolean }> {
  const types = await db.listNoteTypes();
  const wanted = ref === undefined || ref === null || ref === "" ? "Basic" : ref;
  if (typeof wanted === "number" || /^\d+$/.test(String(wanted).trim())) {
    const nt = types.find((t) => t.id === Number(wanted));
    if (nt) return { nt, created: false };
  }
  const name = String(wanted).trim().toLowerCase();
  const found = types.find((t) => t.name.toLowerCase() === name);
  if (found) return { nt: found, created: false };
  const stock = STOCK[name];
  if (!stock) fail(`no note type "${String(wanted)}"; existing: ${types.map((t) => t.name).join(", ") || "none"}`);
  const id = await db.createStockNoteType(stock!);
  const nt = (await db.listNoteTypes()).find((t) => t.id === id);
  if (!nt) throw new Error("the new note type is missing");
  return { nt, created: true };
}

/** Field values in note-type order: from an array (as is) or an object by field name (others keep `base`). */
function fieldValues(nt: NoteType, input: unknown, base: string[], where: string): string[] {
  const names = nt.fields.map((f) => f.name);
  if (Array.isArray(input)) {
    if (input.some((v) => typeof v !== "string")) fail(`${where}fields must be strings`);
    if (input.length > names.length) fail(`${where}${input.length} fields given, "${nt.name}" has ${names.length}: ${names.join(", ")}`);
    return names.map((_, i) => (input[i] as string | undefined) ?? base[i] ?? "");
  }
  if (!input || typeof input !== "object") fail(`${where}fields must be an object (by field name) or an array`);
  const out = names.map((_, i) => base[i] ?? "");
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    let i = names.indexOf(k);
    if (i < 0) i = names.findIndex((n) => n.toLowerCase() === k.toLowerCase());
    if (i < 0) fail(`${where}"${nt.name}" has no field "${k}"; its fields are ${names.join(", ")}`);
    if (typeof v !== "string") fail(`${where}field "${k}" must be a string`);
    out[i] = v as string;
  }
  return out;
}

const dueText = (d: ItemDue): string | number => (d.kind === "new" ? "new" : new Date(d.at).toISOString());

export async function runAgentTool(db: AgentDb, tool: string, rawArgs: unknown, client: AgentClient): Promise<AgentOutcome> {
  const args = obj(rawArgs);
  switch (tool) {
    case "list_decks": {
      const decks = flatDecks(await db.deckTree());
      return {
        result: decks
          .filter((d) => d.kind === "normal")
          .map((d) => ({ id: d.id, name: d.name, cards: d.totalItems, dueToday: d.counts })),
      };
    }

    case "list_note_types": {
      const types = await db.listNoteTypes();
      return {
        result: types.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          fields: t.fields.map((f) => f.name),
          templates: t.templates.map((x) => x.name),
        })),
      };
    }

    case "search_notes": {
      const limit = args["limit"] === undefined ? 20 : Math.min(200, Math.max(1, int(args["limit"], "limit")));
      const offset = args["offset"] === undefined ? 0 : int(args["offset"], "offset");
      const tags = tagList(args["tags"], "tags");
      const text = args["text"] === undefined ? "" : String(args["text"]);
      const deck = args["deck"] === undefined ? undefined : await findDeck(db, args["deck"], "deck");
      const decks = new Map(flatDecks(await db.deckTree()).map((d) => [d.id, d.name]));
      const page = await db.search({ text, ...(deck ? { deckId: deck.id } : {}), ...(tags.length ? { tags } : {}), limit, offset });
      return {
        result: {
          total: page.total,
          offset: page.offset,
          notes: page.rows.map((r) => ({
            id: r.id,
            noteType: r.noteTypeName,
            first: r.sortField,
            tags: r.tags,
            decks: r.deckIds.map((id) => decks.get(id) ?? id),
            cards: r.itemCount,
          })),
        },
      };
    }

    case "get_note": {
      const kp = await db.getKnowledgePoint(int(args["id"], "id"));
      if (!kp) fail(`no note ${String(args["id"])}`);
      const k = kp!;
      return {
        result: {
          id: k.id,
          noteType: k.noteType.name,
          fields: Object.fromEntries(k.fieldNames.map((n, i) => [n, k.fields[i] ?? ""])),
          tags: k.tags,
          createdAt: new Date(k.createdAt).toISOString(),
          modifiedAt: new Date(k.modifiedAt).toISOString(),
          cards: k.items.map((it) => ({
            id: it.id,
            template: k.noteType.kind === "cloze" ? `c${it.ord + 1}` : (k.noteType.templates[it.ord]?.name ?? `#${it.ord + 1}`),
            deck: k.deckNames[it.deckId] ?? it.deckId,
            state: it.state,
            status: it.status,
            due: dueText(it.due),
            reviews: it.reps,
            lapses: it.lapses,
          })),
        },
      };
    }

    case "create_deck": {
      const name = str(args["name"], "name");
      const before = new Set(flatDecks(await db.deckTree()).map((d) => d.id));
      const id = await db.createDeck(name);
      const deck = flatDecks(await db.deckTree()).find((d) => d.id === id);
      const created = !before.has(id);
      return { result: { id, name: deck?.name ?? name, created }, change: { kind: "deck", name: deck?.name ?? name, created } };
    }

    case "add_notes": {
      const notes = args["notes"];
      if (!Array.isArray(notes) || notes.length === 0) fail("notes must be a non-empty array");
      if ((notes as unknown[]).length > 500) fail("at most 500 notes per call");
      const { nt, created } = await noteTypeFor(db, args["noteType"]);
      const tag = agentTag(client);
      const inputs = (notes as unknown[]).map((n, i) => {
        const where = `notes[${i}]: `;
        if (!n || typeof n !== "object" || Array.isArray(n)) fail(`${where}must be an object with fields`);
        const note = n as Record<string, unknown>;
        const fields = fieldValues(nt, note["fields"], [], where);
        if (fields.every((f) => !f.trim())) fail(`${where}all fields are empty`);
        const tags = [...new Set([...tagList(note["tags"], `${where}tags`), tag])];
        return { fields, tags };
      });
      // the deck is created only once the notes are known to be valid
      let deck: DeckNode;
      const ref = args["deck"];
      try {
        deck = await findDeck(db, ref, "deck");
      } catch (e) {
        if (!(e instanceof AgentInputError) || typeof ref !== "string" || /^\d+$/.test(ref.trim())) throw e;
        const id = await db.createDeck(str(ref, "deck"));
        deck = flatDecks(await db.deckTree()).find((d) => d.id === id)!;
      }
      let batch;
      try {
        batch = await db.addKnowledgePoints(inputs.map((x) => ({ noteTypeId: nt.id, deckId: deck.id, fields: x.fields, tags: x.tags })));
      } catch (e) {
        // the engine's message names the note (e.g. "knowledge point 2: … no review items")
        throw new AgentInputError(e instanceof Error ? e.message : String(e));
      }
      return {
        result: {
          deck: { id: deck.id, name: deck.name },
          noteType: nt.name,
          tag,
          added: batch.added.map((r) => ({ id: r.id, cards: r.itemIds.length })),
        },
        change: { kind: "add", count: batch.added.length, deck: deck.name, undoStepId: batch.undoStepId! },
        structure: created,
      };
    }

    case "update_note": {
      const id = int(args["id"], "id");
      const kp = await db.getKnowledgePoint(id);
      if (!kp) fail(`no note ${id}`);
      if (args["fields"] === undefined && args["tags"] === undefined) fail("give fields and/or tags to change");
      const fields = args["fields"] === undefined ? undefined : fieldValues(kp!.noteType, args["fields"], kp!.fields, "");
      const tags = args["tags"] === undefined ? undefined : tagList(args["tags"], "tags");
      const r = await db.updateKnowledgePoint({ id, ...(fields ? { fields } : {}), ...(tags ? { tags } : {}) });
      return { result: { id, addedCards: r.addedItemIds.length }, change: { kind: "update", id } };
    }

    default:
      return fail(`unknown tool ${tool}`);
  }
}
