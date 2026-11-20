import { describe, expect, it } from "vitest";

import { decideCardLayout, isListLikeLine, metricsFromLines, visualLength } from "./layout.ts";

describe("visualLength", () => {
  it("counts CJK as 2 and Latin as 1", () => {
    expect(visualLength("犬")).toBe(2);
    expect(visualLength("ephemeral")).toBe(9);
    expect(visualLength("CAP 定理")).toBe(8);
    expect(visualLength("  hello   world  ")).toBe(11);
  });
});

describe("isListLikeLine", () => {
  it("detects numbered and bulleted plain-text lines", () => {
    expect(isListLikeLine("1. 读写不互斥")).toBe(true);
    expect(isListLikeLine("2、写入更少刷盘")).toBe(true);
    expect(isListLikeLine("- first item")).toBe(true);
    expect(isListLikeLine("① 步骤一")).toBe(true);
    expect(isListLikeLine("WAL 将修改追加写入")).toBe(false);
  });
});

describe("decideCardLayout", () => {
  it("centers and enlarges short vocabulary cards", () => {
    const layout = decideCardLayout(metricsFromLines(["猫"]), metricsFromLines(["猫", "cat", "猫が好きです。"]), true);
    expect(layout).toEqual({ centered: true, shortPrompt: true, promptHeading: false });
  });

  it("centers short type-in phrase cards without blowing up the prompt size", () => {
    const layout = decideCardLayout(metricsFromLines(["「ありがとう」 in English?"]), metricsFromLines(["Thank you"]), true);
    expect(layout).toEqual({ centered: true, shortPrompt: false, promptHeading: true });
  });

  it("left-aligns short-term conceptual cards when the answer is a prose paragraph", () => {
    const layout = decideCardLayout(
      metricsFromLines(["CAP 定理"]),
      metricsFromLines(["分布式系统无法同时满足一致性、可用性、分区容错性，在发生网络分区时必须在 C 和 A 之间权衡。"]),
      true,
    );
    expect(layout).toEqual({ centered: false, shortPrompt: true, promptHeading: false });
  });

  it("left-aligns medium Chinese Q&A cards with numbered points", () => {
    const layout = decideCardLayout(
      metricsFromLines(["为什么 SQLite 的 WAL 模式在读多写少场景下性能显著优于传统的回滚日志（Rollback Journal）模式？"]),
      metricsFromLines([
        "WAL 将修改追加写入独立的预写日志文件，而不是覆盖主库页面：",
        "1. 读写不互斥：读事务继续读快照，写事务只需顺序追加 WAL。",
        "2. 写入更少刷盘：只需一次顺序写，检查点（checkpoint）再批量回写主库。",
      ]),
      true,
    );
    expect(layout).toEqual({ centered: false, shortPrompt: false, promptHeading: true });
  });

  it("left-aligns short numbered lists even when each line is brief", () => {
    const layout = decideCardLayout(
      metricsFromLines(["TCP 三次握手"]),
      metricsFromLines(["1. 发 SYN", "2. 回 SYN-ACK", "3. 回 ACK"]),
      true,
    );
    expect(layout).toEqual({ centered: false, shortPrompt: true, promptHeading: false });
  });

  it("left-aligns cards with structured HTML blocks", () => {
    const layout = decideCardLayout(
      metricsFromLines(["HTTP 幂等方法"]),
      metricsFromLines(["GET", "PUT"], { hasStructuredBlock: true }),
      true,
    );
    expect(layout).toEqual({ centered: false, shortPrompt: true, promptHeading: false });
  });

  it("avoids stacking shortPrompt or promptHeading when front already has wg-large", () => {
    const layout = decideCardLayout(
      metricsFromLines(["猫"], { hasLarge: true }),
      metricsFromLines(["猫", "cat", "猫が好きです。"]),
      true,
    );
    expect(layout).toEqual({ centered: true, shortPrompt: false, promptHeading: false });
  });

  it("left-aligns cloze cards without prompt heading emphasis", () => {
    const layout = decideCardLayout(
      metricsFromLines(["SQLite 在 [...] 模式下允许读写并发。"], { hasCloze: true }),
      null,
      false,
    );
    expect(layout).toEqual({ centered: false, shortPrompt: false, promptHeading: false });
  });
});
