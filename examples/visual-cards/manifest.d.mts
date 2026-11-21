import type { VisualLibraryId, VisualSourceReference } from "@wengu/core";

export interface StarterCardSpec {
  id: string;
  title: string;
  archetype: string;
  subject: string;
  tags: string[];
  front: string;
  back: string;
  libraries: VisualLibraryId[];
  sources: VisualSourceReference[];
  file: string;
  defaultProps: Record<string, unknown>;
}

export interface LoadedStarterCard extends StarterCardSpec {
  source: string;
}

export const STARTER_DECK: string;
export const STARTER_CARDS: StarterCardSpec[];
export function loadStarterCards(): LoadedStarterCard[];
