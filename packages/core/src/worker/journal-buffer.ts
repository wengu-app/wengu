/** Bounded, contiguous writes. A failed sink keeps the pending bytes for the caller's error path. */
export class JournalBuffer {
  private readonly bytes: Uint8Array;
  private offset = 0;
  private length = 0;

  constructor(private readonly sink: (bytes: Uint8Array, offset: number) => number, capacity = 64 * 1024) {
    this.bytes = new Uint8Array(capacity);
  }

  write(bytes: Uint8Array, offset: number): number {
    if (this.length && (offset !== this.offset + this.length || this.length + bytes.length > this.bytes.length)) {
      const rc = this.flush();
      if (rc) return rc;
    }
    if (bytes.length > this.bytes.length) return this.sink(bytes, offset);
    if (!this.length) this.offset = offset;
    this.bytes.set(bytes, this.length);
    this.length += bytes.length;
    return 0;
  }

  flush(): number {
    if (!this.length) return 0;
    const rc = this.sink(this.bytes.subarray(0, this.length), this.offset);
    if (!rc) this.length = 0;
    return rc;
  }
}
