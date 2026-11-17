import type { BrowseQuery } from "../src/types.js";

/** Browse queries covering every combination of text × deck × tag × state × sort, plus note type. */
export function combinations(top: number, leaf: number, nt: number): [string, BrowseQuery][] {
  const texts: [string, string | undefined][] = [["-", undefined], ["common word", "theorem"], ["rare", "answer 4242"], ["1 CJK char", "猫"]];
  const decks: [string, number | undefined][] = [["-", undefined], ["top deck", top], ["leaf deck", leaf]];
  const tags: [string, string[] | undefined][] = [["-", undefined], ["tag+children", ["science"]]];
  const states: [string, BrowseQuery["state"]][] = [["-", undefined], ["due", "due"], ["new", "new"], ["suspended", "suspended"], ["review", "review"]];
  const sorts: [string, BrowseQuery["sort"]][] = [["created", undefined], ["modified", { by: "modified" }], ["sortField", { by: "sortField" }]];
  const out: [string, BrowseQuery][] = [];
  for (const [tn, text] of texts)
    for (const [dn, deckId] of decks)
      for (const [gn, tg] of tags)
        for (const [sn, state] of states)
          for (const [on, sort] of sorts) {
            const q: BrowseQuery = { limit: 50 };
            if (text) q.text = text;
            if (deckId !== undefined) q.deckId = deckId;
            if (tg) q.tags = tg;
            if (state) q.state = state;
            if (sort) q.sort = sort;
            out.push([`text ${tn} | deck ${dn} | tag ${gn} | state ${sn} | sort ${on}`, q]);
          }
  // note type
  out.push(["note type only", { noteTypeId: nt }], ["note type + text + state", { noteTypeId: nt, text: "theorem", state: "due" }]);
  return out;
}
