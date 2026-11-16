import type { Deck, DeckConfig, Notetype, NotetypeField, CardTemplate } from "@wengu/anki";

/** Anki's default deck options preset (id 1), as Anki 26.x creates it. */
export function defaultPreset(id = 1, name = "Default", mtime = 0): DeckConfig {
  return {
    id,
    name,
    mtime,
    usn: 0,
    learnSteps: [1, 10],
    relearnSteps: [10],
    newPerDay: 20,
    reviewsPerDay: 200,
    newPerDayMinimum: 0,
    initialEase: 2.5,
    easyMultiplier: 1.3,
    hardMultiplier: 1.2,
    lapseMultiplier: 0,
    intervalMultiplier: 1,
    maximumReviewInterval: 36500,
    minimumLapseInterval: 1,
    graduatingIntervalGood: 1,
    graduatingIntervalEasy: 4,
    newCardInsertOrder: 0,
    newCardGatherPriority: 0,
    newCardSortOrder: 0,
    newMix: 0,
    reviewOrder: 0,
    interdayLearningMix: 0,
    leechAction: 1,
    leechThreshold: 8,
    disableAutoplay: false,
    capAnswerTimeToSecs: 60,
    showTimer: false,
    stopTimerOnAnswer: false,
    secondsToShowQuestion: 0,
    secondsToShowAnswer: 0,
    questionAction: 0,
    answerAction: 0,
    waitForAudio: true,
    skipQuestionWhenReplayingAnswer: false,
    buryNew: false,
    buryReviews: false,
    buryInterdayLearning: false,
    fsrsParams4: [],
    fsrsParams5: [],
    fsrsParams6: [],
    desiredRetention: 0.9,
    historicalRetention: 0.9,
    ignoreRevlogsBeforeDate: "",
    easyDaysPercentages: [1, 1, 1, 1, 1, 1, 1],
    paramSearch: "",
    extra: {},
  };
}

export function newDeck(id: number, name: string, presetId: number, mtimeSecs: number): Deck {
  const path = name.split("::");
  return {
    id,
    name,
    path,
    parentId: null,
    mtime: mtimeSecs,
    usn: -1,
    kind: "normal",
    description: "",
    markdownDescription: false,
    collapsed: false,
    browserCollapsed: false,
    configId: presetId,
    reviewLimit: null,
    newLimit: null,
    reviewLimitToday: null,
    newLimitToday: null,
    desiredRetention: null,
    extendNew: 0,
    extendReview: 0,
    filtered: null,
    stats: { lastDayStudied: 0, newStudied: 0, reviewStudied: 0, learningStudied: 0, millisecondsStudied: 0 },
    extra: {},
  };
}

const CSS = ".card {\n    font-family: arial;\n    font-size: 20px;\n    line-height: 1.5;\n    text-align: center;\n    color: black;\n    background-color: white;\n}\n";
const CLOZE_CSS = CSS + "\n.cloze {\n    font-weight: bold;\n    color: blue;\n}\n.nightMode .cloze {\n    color: lightblue;\n}\n";
const LATEX_PRE =
  "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";

function field(ord: number, name: string): NotetypeField {
  return {
    ord,
    name,
    sticky: false,
    rtl: false,
    fontName: "Arial",
    fontSize: 20,
    description: "",
    plainText: false,
    collapsed: false,
    excludeFromSearch: false,
    id: null,
    tag: null,
    preventDeletion: false,
    extra: {},
  };
}

function template(ord: number, name: string, qfmt: string, afmt: string, mtime: number): CardTemplate {
  return { ord, name, qfmt, afmt, bqfmt: "", bafmt: "", targetDeckId: null, browserFontName: "", browserFontSize: 0, id: null, mtime, usn: -1, extra: {} };
}

export type StockNoteType = "basic" | "basic-reversed" | "cloze";

/** Anki's stock note types (Basic, Basic (and reversed card), Cloze). */
export function stockNoteType(kind: StockNoteType, id: number, mtimeSecs: number): Notetype {
  const base = {
    id,
    mtime: mtimeSecs,
    usn: -1,
    sortFieldIndex: 0,
    latexPre: LATEX_PRE,
    latexPost: "\\end{document}",
    latexSvg: false,
    originalId: null,
    extra: {},
  };
  const back = "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}";
  if (kind === "cloze") {
    return {
      ...base,
      name: "Cloze",
      kind: "cloze",
      css: CLOZE_CSS,
      requirements: [],
      originalStockKind: 5,
      fields: [field(0, "Text"), field(1, "Back Extra")],
      templates: [template(0, "Cloze", "{{cloze:Text}}", "{{cloze:Text}}<br>\n{{Back Extra}}", mtimeSecs)],
    };
  }
  const templates = [template(0, "Card 1", "{{Front}}", back, mtimeSecs)];
  if (kind === "basic-reversed") templates.push(template(1, "Card 2", "{{Back}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}", mtimeSecs));
  return {
    ...base,
    name: kind === "basic" ? "Basic" : "Basic (and reversed card)",
    kind: "normal",
    css: CSS,
    requirements: [],
    originalStockKind: kind === "basic" ? 1 : 2,
    fields: [field(0, "Front"), field(1, "Back")],
    templates,
  };
}
