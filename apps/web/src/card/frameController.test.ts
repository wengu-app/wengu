import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FrameToHost, HostToFrame } from "../frame/protocol.ts";
import { FrameController, type FrameCard } from "./frameController.ts";

class Port {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage = vi.fn<(m: HostToFrame) => void>();
  close = vi.fn();
  receive(data: FrameToHost) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

class Channel {
  static all: Channel[] = [];
  port1 = new Port();
  port2 = new Port();
  constructor() {
    Channel.all.push(this);
  }
}

class Frame extends EventTarget {
  src = "";
  nextSibling = null;
  parentNode = { insertBefore: vi.fn() };
  contentWindow = { postMessage: vi.fn() };
  remove = vi.fn();
  load() {
    this.dispatchEvent(new Event("load"));
    return Channel.all.at(-1)!.port1;
  }
}

const card = (question = "first"): FrameCard => ({
  mode: "wengu", question, answer: "answer", css: "", cardClass: "card card1",
  media: { "image.png": new Blob(["image"]) }, hasMath: false, side: "question", emphasis: {},
});
const shows = (p: Port) => p.postMessage.mock.calls.map(([m]) => m).filter((m) => m.t === "show");

describe("card frame recovery", () => {
  let frame: Frame;
  let ctl: FrameController;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { baseURI: "https://wengu.test/" });
    vi.stubGlobal("MessageChannel", Channel);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    Channel.all = [];
    frame = new Frame();
    ctl = new FrameController(frame as unknown as HTMLIFrameElement);
  });
  afterEach(() => {
    ctl.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bounds a missing load/ready handshake and never blocks advancing to the next card", async () => {
    const first = await ctl.show(card());
    await vi.advanceTimersByTimeAsync(5000);
    expect(frame.remove).toHaveBeenCalledTimes(1);
    // A second timeout must not abandon a pending show on an older readiness promise.
    await vi.advanceTimersByTimeAsync(5000);
    expect(frame.remove).toHaveBeenCalledTimes(2);
    const next = await ctl.show(card("next"));
    expect(next).toBe(first + 1);
    const port = frame.load();
    port.receive({ t: "ready" });
    expect(shows(port)).toMatchObject([{ seq: next, question: "next" }]);
    port.receive({ t: "shown", seq: next, side: "question" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(frame.remove).toHaveBeenCalledTimes(2);
  });

  it("replays the current answer, theme and media after an external reload without changing its sequence", async () => {
    ctl.setTheme({ dark: true, vars: { "--wg-color": "red" } });
    const port = frame.load();
    port.receive({ t: "ready" });
    const seq = await ctl.show(card());
    ctl.reveal("typed answer comparison");
    port.receive({ t: "shown", seq, side: "answer" });
    const restored = frame.load();
    restored.receive({ t: "ready" });
    expect(ctl.currentSeq).toBe(seq);
    expect(restored.postMessage.mock.calls[0]![0]).toMatchObject({ t: "theme", theme: { dark: true } });
    expect(shows(restored)).toMatchObject([{ seq, side: "answer", typeCompare: "typed answer comparison", media: { "image.png": expect.any(Blob) } }]);
  });

  it("ignores obsolete ports and acknowledgements for an older card or side", async () => {
    const old = frame.load();
    old.receive({ t: "ready" });
    const seq = await ctl.show(card());
    const fresh = frame.load();
    const onShown = vi.fn();
    ctl.events = { onShown };
    old.receive({ t: "ready" });
    old.receive({ t: "shown", seq, side: "question" });
    expect(fresh.postMessage).not.toHaveBeenCalled();
    fresh.receive({ t: "ready" });
    ctl.reveal(null);
    fresh.receive({ t: "shown", seq: seq - 1, side: "answer" });
    fresh.receive({ t: "shown", seq, side: "question" });
    expect(onShown).not.toHaveBeenCalled();
    fresh.receive({ t: "shown", seq, side: "answer" });
    expect(onShown).toHaveBeenCalledExactlyOnceWith(seq, "answer");
  });

  it("reveal during reconnection queues the answer instead of losing it", async () => {
    const seq = await ctl.show(card());
    ctl.reveal("comparison");
    const port = frame.load();
    port.receive({ t: "ready" });
    expect(shows(port)).toMatchObject([{ seq, side: "answer", typeCompare: "comparison" }]);
    port.receive({ t: "ready" });
    expect(shows(port)).toHaveLength(1);
  });

  it("repeated reveal/rating input cannot keep postponing recovery of a dead renderer", async () => {
    const port = frame.load();
    port.receive({ t: "ready" });
    await ctl.show(card());
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      ctl.reveal(null);
      await ctl.show(card(`next ${i}`));
    }
    expect(frame.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(frame.remove).toHaveBeenCalledTimes(1);
    const fresh = frame.load();
    fresh.receive({ t: "ready" });
    expect(shows(fresh)).toMatchObject([{ seq: ctl.currentSeq, question: "next 3" }]);
  });

  it("clear cancels recovery and prevents the previous card from replaying", async () => {
    await ctl.show(card());
    await vi.advanceTimersByTimeAsync(5000);
    ctl.clear();
    const port = frame.load();
    port.receive({ t: "ready" });
    expect(shows(port)).toEqual([]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(frame.remove).toHaveBeenCalledTimes(1);
  });

  it("dispose closes the connection and cancels recovery", async () => {
    await ctl.show(card());
    const port = frame.load();
    ctl.dispose();
    port.receive({ t: "ready" });
    frame.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(10000);
    expect(port.close).toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(frame.remove).not.toHaveBeenCalled();
    expect(Channel.all).toHaveLength(1);
  });
});
