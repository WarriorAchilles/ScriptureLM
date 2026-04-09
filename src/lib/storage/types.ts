import type { Readable } from "node:stream";

export type BlobStorage = {
  put(storageKey: string, body: Buffer): Promise<void>;
  /** Stream for large objects; callers must consume or destroy the stream. */
  getStream(storageKey: string): Promise<Readable>;
  delete(storageKey: string): Promise<void>;
};
