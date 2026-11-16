/**
 * Objects every Anki collection has, used when a model lacks them and for
 * the compatibility collection inside packages. Values are those of a fresh
 * Anki 26.09 collection (as found in its exported files).
 */
import type { Deck, DeckConfig, Notetype } from "./model.js";

/** The "Default" deck (id 1), as Anki exports it. */
export function defaultDeck(): Deck {
  return {
    id: 1,
    name: "Default",
    path: ["Default"],
    parentId: null,
    mtime: 0,
    usn: 0,
    kind: "normal",
    description: "",
    markdownDescription: false,
    collapsed: true,
    browserCollapsed: true,
    configId: 1,
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

/** The "Default" deck options preset (id 1) with Anki's default settings. */
export function defaultDeckConfig(): DeckConfig {
  return {
    id: 1,
    name: "Default",
    mtime: 0,
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

const DEFAULT_CSS =
  ".card {\n    font-family: arial;\n    font-size: 20px;\n    line-height: 1.5;\n    text-align: center;\n    color: black;\n    background-color: white;\n}\n";
const LATEX_PRE =
  "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";

/** A plain "Basic" notetype (Front/Back, one card). Field and template ids are left null. */
export function basicNotetype(id: number, mtime: number): Notetype {
  const field = (name: string, ord: number) => ({
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
  });
  return {
    id,
    name: "Basic",
    kind: "normal",
    mtime,
    usn: -1,
    sortFieldIndex: 0,
    css: DEFAULT_CSS,
    latexPre: LATEX_PRE,
    latexPost: "\\end{document}",
    latexSvg: false,
    requirements: [{ cardOrd: 0, kind: "any", fieldOrds: [0] }],
    originalStockKind: 1,
    originalId: null,
    fields: [field("Front", 0), field("Back", 1)],
    templates: [
      {
        ord: 0,
        name: "Card 1",
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
        bqfmt: "",
        bafmt: "",
        targetDeckId: null,
        browserFontName: "",
        browserFontSize: 0,
        id: null,
        mtime,
        usn: -1,
        extra: {},
      },
    ],
    extra: {},
  };
}
