/**
 * Content-addressed media storage. The database maps file names to SHA-256 hashes; bytes live here, outside
 * the database, one file per distinct content.
 */
export interface MediaStore {
  readonly kind: "opfs" | "memory";
  /** Stores `data` under `hash` (no-op when present). */
  put(hash: string, data: Uint8Array): Promise<void>;
  has(hash: string): Promise<boolean>;
  /** The content as a Blob (in the browser: a `File` backed by OPFS, cheap to pass to the main thread). */
  get(hash: string, type?: string): Promise<Blob | null>;
  bytes(hash: string): Promise<Uint8Array | null>;
  delete(hash: string): Promise<void>;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  let s = "";
  for (const b of new Uint8Array(digest)) s += b.toString(16).padStart(2, "0");
  return s;
}

export class MemoryMediaStore implements MediaStore {
  readonly kind = "memory" as const;
  private readonly files = new Map<string, Uint8Array>();
  async put(hash: string, data: Uint8Array): Promise<void> {
    if (!this.files.has(hash)) this.files.set(hash, data.slice());
  }
  async has(hash: string): Promise<boolean> {
    return this.files.has(hash);
  }
  async get(hash: string, type = ""): Promise<Blob | null> {
    const d = this.files.get(hash);
    return d ? new Blob([d as Uint8Array<ArrayBuffer>], { type }) : null;
  }
  async bytes(hash: string): Promise<Uint8Array | null> {
    return this.files.get(hash)?.slice() ?? null;
  }
  async delete(hash: string): Promise<void> {
    this.files.delete(hash);
  }
  get size(): number {
    return this.files.size;
  }
}

/**
 * OPFS-backed store: `<root>/<first two hex chars>/<hash>`. Works in workers and on the main thread
 * (uses only the async OPFS API, so it does not conflict with SQLite's sync access handles).
 */
export class OpfsMediaStore implements MediaStore {
  readonly kind = "opfs" as const;
  private readonly dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  static async open(dirName = "wengu-media"): Promise<OpfsMediaStore> {
    const opfs = await navigator.storage.getDirectory();
    return new OpfsMediaStore(await opfs.getDirectoryHandle(dirName, { create: true }));
  }

  private shard(hash: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    const key = hash.slice(0, 2);
    let d = this.dirs.get(key);
    if (!d) {
      d = this.root.getDirectoryHandle(key, { create });
      if (create) this.dirs.set(key, d);
      else d.catch(() => undefined);
    }
    return d;
  }

  private async handle(hash: string): Promise<FileSystemFileHandle | null> {
    try {
      return await (await this.shard(hash, false)).getFileHandle(hash);
    } catch {
      return null;
    }
  }

  async put(hash: string, data: Uint8Array): Promise<void> {
    if (await this.handle(hash)) return;
    const dir = await this.shard(hash, true);
    // Write to a temporary name, then rename: a crash never leaves a truncated file under the real address.
    const tmp = await dir.getFileHandle(`${hash}.tmp`, { create: true });
    const w = await tmp.createWritable();
    await w.write(data as Uint8Array<ArrayBuffer>);
    await w.close();
    const movable = tmp as FileSystemFileHandle & { move?: (name: string) => Promise<void> };
    if (movable.move) await movable.move(hash);
    else {
      const f = await dir.getFileHandle(hash, { create: true });
      const w2 = await f.createWritable();
      await w2.write(data as Uint8Array<ArrayBuffer>);
      await w2.close();
      await dir.removeEntry(`${hash}.tmp`);
    }
  }

  async has(hash: string): Promise<boolean> {
    return (await this.handle(hash)) !== null;
  }

  async get(hash: string, type = ""): Promise<Blob | null> {
    const h = await this.handle(hash);
    if (!h) return null;
    const f = await h.getFile();
    return type && f.type !== type ? new Blob([f], { type }) : f;
  }

  async bytes(hash: string): Promise<Uint8Array | null> {
    const b = await this.get(hash);
    return b ? new Uint8Array(await b.arrayBuffer()) : null;
  }

  async delete(hash: string): Promise<void> {
    try {
      await (await this.shard(hash, false)).removeEntry(hash);
    } catch {
      /* already gone */
    }
  }
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  css: "text/css",
  js: "text/javascript",
  pdf: "application/pdf",
};

export function mimeType(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}
