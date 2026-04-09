/**
 * Server-only blob storage for source files (Step 06).
 * Do not import from client components.
 */

import { getServerEnv } from "@/lib/config";
import { createFilesystemBlobStorage } from "@/lib/storage/filesystem-backend";
import { createS3BlobStorage } from "@/lib/storage/s3-backend";
import type { BlobStorage } from "@/lib/storage/types";

let cached: BlobStorage | undefined;

export type { BlobStorage } from "@/lib/storage/types";
export {
  assertSafeStorageKey,
  buildSourceStorageKey,
  sanitizeSourceFilename,
} from "@/lib/storage/keys";

export function getBlobStorage(): BlobStorage {
  if (cached) {
    return cached;
  }
  const env = getServerEnv();
  if (env.storageBackend === "filesystem") {
    if (!env.sourceStorageRoot) {
      throw new Error(
        "SOURCE_STORAGE_ROOT must be set when STORAGE_BACKEND is filesystem",
      );
    }
    cached = createFilesystemBlobStorage(env.sourceStorageRoot);
    return cached;
  }
  if (!env.awsRegion || !env.s3Bucket) {
    throw new Error(
      "AWS_REGION and S3_BUCKET must be set when STORAGE_BACKEND is s3",
    );
  }
  const endpoint = env.s3Endpoint || undefined;
  cached = createS3BlobStorage({
    region: env.awsRegion,
    bucket: env.s3Bucket,
    ...(endpoint ? { endpoint } : {}),
  });
  return cached;
}

/** For tests that need a fresh backend after env or implementation changes. */
export function resetBlobStorageCacheForTests(): void {
  cached = undefined;
}

/**
 * Read full object into memory (convenience for ingest; Step 07).
 * Prefer `getBlobStorage().getStream` for very large files.
 */
export async function getObjectBuffer(storageKey: string): Promise<Buffer> {
  const storage = getBlobStorage();
  const stream = await storage.getStream(storageKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Alias for `getObjectBuffer` (master spec wording). */
export const getObject = getObjectBuffer;
