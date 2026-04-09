import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { assertSafeStorageKey } from "@/lib/storage/keys";
import type { BlobStorage } from "@/lib/storage/types";

function resolvePathUnderRoot(root: string, storageKey: string): string {
  assertSafeStorageKey(storageKey);
  const rootResolved = path.resolve(root);
  const segments = storageKey.split("/");
  const fullPath = path.resolve(rootResolved, ...segments);
  const relative = path.relative(rootResolved, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Storage key resolves outside SOURCE_STORAGE_ROOT");
  }
  return fullPath;
}

export function createFilesystemBlobStorage(root: string): BlobStorage {
  if (!root.trim()) {
    throw new Error("SOURCE_STORAGE_ROOT is required for filesystem blob storage");
  }

  return {
    async put(storageKey: string, body: Buffer): Promise<void> {
      const filePath = resolvePathUnderRoot(root, storageKey);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, body);
    },

    async getStream(storageKey: string): Promise<Readable> {
      const filePath = resolvePathUnderRoot(root, storageKey);
      return createReadStream(filePath);
    },

    async delete(storageKey: string): Promise<void> {
      const filePath = resolvePathUnderRoot(root, storageKey);
      await unlink(filePath);
    },
  };
}
