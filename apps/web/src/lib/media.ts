/**
 * Media on the app side: a cache of Blobs from `getMedia` (OPFS-backed Files, cheap to hold) and audio playback.
 * Audio plays in the app page, not in the card frame, so the user's keypress counts as the gesture that allows it.
 */
import type { AnkiTemplatePresentation, WenguClient } from "@wengu/core";

type AvTag = AnkiTemplatePresentation["questionAvTags"][number];

export class MediaCache {
  private blobs = new Map<string, Blob | null>();
  private urls = new Map<string, string>();

  constructor(private readonly db: Pick<WenguClient, "getMedia">) {}

  /** Blobs for the names (missing files are omitted). One round trip for whatever is not cached. */
  async get(names: readonly string[]): Promise<Record<string, Blob>> {
    const need = names.filter((n) => !this.blobs.has(n));
    if (need.length) {
      const got = await this.db.getMedia([...new Set(need)]);
      for (const n of need) this.blobs.set(n, got[n] ?? null);
      if (this.blobs.size > 3000) this.trim();
    }
    const out: Record<string, Blob> = {};
    for (const n of names) {
      const b = this.blobs.get(n);
      if (b) out[n] = b;
    }
    return out;
  }

  /** An object URL in the app page (for the editor and audio). */
  async url(name: string): Promise<string | undefined> {
    const u = this.urls.get(name);
    if (u) return u;
    const b = (await this.get([name]))[name];
    if (!b) return undefined;
    const url = URL.createObjectURL(b);
    this.urls.set(name, url);
    return url;
  }

  /** After an import or edit, files may have changed. */
  invalidate(): void {
    this.blobs.clear();
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
  }

  private trim(): void {
    let n = this.blobs.size - 2000;
    for (const k of this.blobs.keys()) {
      if (n-- <= 0) break;
      this.blobs.delete(k);
    }
  }
}

export class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private token = 0;

  constructor(private readonly media: MediaCache) {}

  stop(): void {
    this.token++;
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  /** Plays the tags one after another; a new call (or stop) interrupts. */
  async play(tags: readonly AvTag[]): Promise<void> {
    this.stop();
    const token = this.token;
    for (const tag of tags) {
      if (token !== this.token) return;
      try {
        if (tag.kind === "sound") await this.playSound(tag.filename, token);
        else await this.speak(tag.text, tag.lang, tag.speed, token);
      } catch {
        /* unsupported format or blocked autoplay: skip to the next */
      }
    }
  }

  private async playSound(name: string, token: number): Promise<void> {
    const url = await this.media.url(name);
    if (!url || token !== this.token) return;
    const a = new Audio(url);
    this.audio = a;
    await new Promise<void>((resolve) => {
      a.onended = a.onerror = a.onpause = () => resolve();
      a.play().catch(() => resolve());
    });
  }

  private speak(text: string, lang: string, speed: number | null, token: number): Promise<void> {
    if (typeof speechSynthesis === "undefined" || !text || token !== this.token) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (lang) u.lang = lang.replace("_", "-");
      if (speed) u.rate = speed;
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
      setTimeout(resolve, Math.min(15000, 1500 + text.length * 120));
    });
  }
}
