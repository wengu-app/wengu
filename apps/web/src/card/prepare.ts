import type { AnkiTemplatePresentation, Id, Presentation } from "@wengu/core";

import type { AppContextValue } from "../lib/app.tsx";
import { prepareCard, type PreparedCard } from "../lib/cardPrep.ts";
import type { Translate } from "../lib/i18n.ts";
import type { UnsafeReason } from "../lib/renderMode.ts";
import type { Settings } from "../lib/settings.ts";
import type { FrameCard } from "./frameController.ts";

export function templateOf(p: Presentation): AnkiTemplatePresentation | null {
  return p.kind === "anki-template" ? p : null;
}

export function prepareFor(
  app: Pick<AppContextValue, "noteType" | "analysis">,
  settings: Settings,
  t: Translate,
  presentation: AnkiTemplatePresentation,
  noteTypeId: Id,
  fields: readonly string[],
  ord: number,
): PreparedCard {
  return prepareCard({
    presentation,
    noteType: app.noteType(noteTypeId),
    analysis: app.analysis(noteTypeId),
    fields,
    ord,
    modeSetting: settings.noteTypeModes[String(noteTypeId)],
    renderDefault: settings.renderDefault,
    labels: { replay: t("review.replay"), typePlaceholder: t("review.typePlaceholder") },
  });
}

export function frameCard(p: PreparedCard, media: Record<string, Blob>, side: "question" | "answer"): FrameCard {
  return {
    mode: p.decision.mode,
    question: p.question,
    answer: p.answer,
    css: p.css,
    cardClass: p.cardClass,
    media,
    hasMath: p.hasMath,
    side,
    emphasis: p.emphasis,
  };
}

export function reasonText(reason: UnsafeReason | { kind: "forced" } | { kind: "fieldScript" } | { kind: "default" }, t: Translate): string {
  switch (reason.kind) {
    case "script":
      return t("mode.reason.script");
    case "handlers":
      return t("mode.reason.handlers");
    case "embed":
      return t("mode.reason.embed");
    case "css":
      return t("mode.reason.css", { props: reason.props.join(", ") });
    case "fontFace":
      return t("mode.reason.fontFace");
    case "import":
      return t("mode.reason.import");
    case "fieldScript":
      return t("mode.reason.fieldScript");
    case "forced":
      return t("mode.reason.forced");
    case "default":
      return t("settings.render.original");
  }
}
