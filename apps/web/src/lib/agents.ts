/**
 * Local agents (desktop only): runs the tool calls the shell relays from `Wengu --mcp`, tells the user what an agent
 * changed (with undo), and remembers which agents have connected, for Settings.
 */
import { useEffect, useSyncExternalStore } from "react";

import { AgentInputError, runAgentTool } from "../agent/run.ts";
import type { AgentCall, AgentClient } from "../agent/tools.ts";
import { useApp } from "./app.tsx";
import { useT } from "./i18n.ts";
import { getSettings, useSettings } from "./settings.ts";

export interface AgentRecord {
  name: string;
  title?: string;
  version?: string;
  firstSeen: number;
  lastSeen: number;
  calls: number;
  notesAdded: number;
  notesUpdated: number;
}

const KEY = "wengu.agents.v1";

function load(): AgentRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as AgentRecord[]) : [];
  } catch {
    return [];
  }
}

let agents: AgentRecord[] = load();
const listeners = new Set<() => void>();

function record(client: AgentClient, delta: { added?: number; updated?: number }): void {
  const now = Date.now();
  const prev = agents.find((a) => a.name === client.name);
  const next: AgentRecord = {
    name: client.name,
    ...(client.title ? { title: client.title } : prev?.title ? { title: prev.title } : {}),
    ...(client.version ? { version: client.version } : prev?.version ? { version: prev.version } : {}),
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
    calls: (prev?.calls ?? 0) + 1,
    notesAdded: (prev?.notesAdded ?? 0) + (delta.added ?? 0),
    notesUpdated: (prev?.notesUpdated ?? 0) + (delta.updated ?? 0),
  };
  agents = [next, ...agents.filter((a) => a.name !== client.name)].slice(0, 20);
  try {
    localStorage.setItem(KEY, JSON.stringify(agents));
  } catch {
    /* keep in memory */
  }
  for (const l of listeners) l();
}

export function forgetAgents(): void {
  agents = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Agents that have called the app, most recent first. */
export function useAgents(): AgentRecord[] {
  return useSyncExternalStore(subscribe, () => agents, () => agents);
}

/** Display name of an agent. */
export const agentName = (a: Pick<AgentClient, "name" | "title">) => a.title || a.name;

/** Connects the app to the shell's agent bridge: opens it while the setting is on and answers calls. */
export function useAgentBridge(): void {
  const desktop = typeof window === "undefined" ? undefined : window.wenguDesktop;
  const bridge = desktop?.agent;
  const { agentAccess } = useSettings();
  const { db, changed, toast } = useApp();
  const t = useT();

  useEffect(() => {
    bridge?.setAccess(agentAccess);
  }, [bridge, agentAccess]);

  useEffect(() => {
    if (!desktop || !bridge) return;
    // one call at a time, in arrival order
    let queue = Promise.resolve();
    const handle = async (call: AgentCall) => {
      if (!getSettings().agentAccess) {
        bridge.reply({ id: call.id, ok: false, error: "Agent access is turned off in Wengu's settings." });
        return;
      }
      try {
        const out = await runAgentTool(db, call.tool, call.args, call.client);
        bridge.reply({ id: call.id, ok: true, result: out.result });
        const c = out.change;
        record(call.client, { added: c?.kind === "add" ? c.count : 0, updated: c?.kind === "update" ? 1 : 0 });
        if (!c) return;
        await changed(out.structure ?? false);
        const who = agentName(call.client);
        if (c.kind === "add") {
          toast(t("agent.added", { agent: who, n: c.count, deck: c.deck }), {
            label: t("common.undo"),
            run: () =>
              void (async () => {
                // only if the agent's batch is still the latest change
                if (await db.undo({ expectedStepId: c.undoStepId })) await changed();
              })(),
          });
        } else if (c.kind === "update") toast(t("agent.updated", { agent: who }));
        else if (c.created) toast(t("agent.deckCreated", { agent: who, deck: c.name }));
      } catch (e) {
        record(call.client, {});
        const message = e instanceof Error ? e.message : String(e);
        if (!(e instanceof AgentInputError)) console.error("agent call failed", call.tool, e);
        bridge.reply({ id: call.id, ok: false, error: message });
      }
    };
    return desktop.onCommand((cmd) => {
      if (cmd.type !== "agent-call") return;
      queue = queue.then(() => handle(cmd.call));
    });
  }, [desktop, bridge, db, changed, toast, t]);
}
