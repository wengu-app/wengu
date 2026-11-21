import type { VisualLibraryId } from "@wengu/core";
import type { LibraryBundle } from "@wengu/runtime";

const cache = new Map<VisualLibraryId, Promise<LibraryBundle>>();

export function visualFrameUrl(): string {
  return new URL("visual-frame.html", document.baseURI).href;
}

async function fetchLibrary(id: VisualLibraryId): Promise<LibraryBundle> {
  if (id === "three") {
    const url = new URL("visual-libs/three.json", document.baseURI).href;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load library "${id}" (${res.status} ${res.statusText})`);
    }
    return (await res.json()) as LibraryBundle;
  }
  throw new Error(`Visual library "${id}" is not yet bundled in Wengu`);
}

export async function loadVisualLibraries(ids: readonly VisualLibraryId[]): Promise<Record<string, LibraryBundle>> {
  const unique = [...new Set(ids)];
  const out: Record<string, LibraryBundle> = {};
  await Promise.all(
    unique.map(async (id) => {
      let pending = cache.get(id);
      if (!pending) {
        pending = fetchLibrary(id).catch((err) => {
          cache.delete(id);
          throw err;
        });
        cache.set(id, pending);
      }
      out[id] = await pending;
    }),
  );
  return out;
}
