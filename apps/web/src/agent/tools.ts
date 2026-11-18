/**
 * The tools that local agents (Claude Code, Codex, …) get through the desktop app's MCP bridge.
 *
 * Plain data only: the desktop shell's `--mcp` process imports this list to answer `tools/list` without the app,
 * and the app runs the calls (`run.ts`). Names and schemas are the contract with agents; change them with care.
 */

export interface AgentToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: false; idempotentHint: boolean; openWorldHint: false };
}

const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const write = (idempotent: boolean) => ({ readOnlyHint: false, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false }) as const;

const fieldsSchema = {
  description:
    "Field contents as HTML, either an object keyed by field name (see list_note_types; unknown names are an error, missing ones stay empty) or an array in field order.",
  oneOf: [
    { type: "object", additionalProperties: { type: "string" } },
    { type: "array", items: { type: "string" } },
  ],
};

const tagsSchema = {
  type: "array",
  items: { type: "string" },
  description: "Tags (no spaces; use :: for hierarchy, e.g. biology::cells).",
};

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: "list_decks",
    title: "List decks",
    description: "Lists every deck in the user's Wengu (温故) collection with its id, full name (sub-decks separated by ::), number of cards and what is due today.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: read,
  },
  {
    name: "list_note_types",
    title: "List note types",
    description:
      'Lists note types (Anki "models"): their fields in order and card templates. A note of a type with two templates makes two review cards. "Cloze" types use {{c1::hidden text}} in their first field.',
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: read,
  },
  {
    name: "search_notes",
    title: "Search notes",
    description:
      "Searches notes (knowledge points) by text, deck and tags; use it to avoid adding duplicates. Returns each note's id, note type, first field as plain text, tags and decks.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Words that must all appear in the note's fields (case-insensitive, HTML ignored)." },
        deck: { type: "string", description: "Deck name (including its sub-decks) or numeric id." },
        tags: { type: "array", items: { type: "string" }, description: "Tags that must all be present (a tag also matches its children)." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 20." },
        offset: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    annotations: read,
  },
  {
    name: "get_note",
    title: "Get a note",
    description: "Returns one note with all its fields (by name), tags, note type and its review cards (deck, state, due).",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    annotations: read,
  },
  {
    name: "create_deck",
    title: "Create a deck",
    description: "Creates a deck (and missing parents for names like Parent::Child). Returns the existing deck if one has that name.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    annotations: write(true),
  },
  {
    name: "add_notes",
    title: "Add notes",
    description:
      "Adds notes to a deck; Wengu makes their review cards and schedules them with FSRS. All notes are added in one step (the user can undo the whole batch), and nothing is added if one is invalid. " +
      "Fields are HTML. The app is offline: images or scripts from the web do not load. Every note also gets a tag naming the agent (agent::<name>) so the user can find what agents made.",
    inputSchema: {
      type: "object",
      properties: {
        deck: { type: "string", description: "Deck name (created if missing; Parent::Child for sub-decks) or numeric id." },
        noteType: {
          type: "string",
          description: 'Note type name or numeric id (default "Basic": fields Front, Back). "Basic", "Basic (and reversed card)" and "Cloze" are created if the collection lacks them.',
        },
        notes: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: {
            type: "object",
            properties: { fields: fieldsSchema, tags: tagsSchema },
            required: ["fields"],
            additionalProperties: false,
          },
        },
      },
      required: ["deck", "notes"],
      additionalProperties: false,
    },
    annotations: write(false),
  },
  {
    name: "update_note",
    title: "Update a note",
    description: "Changes a note's fields (only the ones given, by name or a full array) and/or replaces its tags. Review history is kept. The user can undo it.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" }, fields: fieldsSchema, tags: tagsSchema },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: write(true),
  },
];

export const AGENT_TOOL_NAMES = new Set(AGENT_TOOLS.map((t) => t.name));

/** Server instructions shown to agents when they connect. */
export const AGENT_INSTRUCTIONS =
  "Wengu (温故) is the user's spaced-repetition app (compatible with Anki). These tools read and write the collection in the running desktop app. " +
  "Before adding, call list_note_types to see the fields, and search_notes to avoid duplicates. Keep each note to one fact; prefer short, precise fronts. " +
  "Use Cloze ({{c1::…}}) for facts embedded in a sentence.";

/** Who is calling: the agent's MCP clientInfo. */
export interface AgentClient {
  name: string;
  title?: string;
  version?: string;
}

/** A call relayed from the `--mcp` process to the app. */
export interface AgentCall {
  id: number;
  tool: string;
  args: unknown;
  client: AgentClient;
}

/** The outcome of a call, without its id. */
export type AgentAnswer = { ok: true; result: unknown } | { ok: false; error: string };
export type AgentReply = { id: number } & AgentAnswer;
