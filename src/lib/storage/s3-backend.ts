import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { assertSafeStorageKey } from "@/lib/storage/keys";
import type { BlobStorage } from "@/lib/storage/types";

export function createS3BlobStorage(options: {
  region: string;
  bucket: string;
  endpoint?: string;
}): BlobStorage {
  const client = new S3Client({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
  });

  return {
    async put(storageKey: string, body: Buffer): Promise<void> {
      assertSafeStorageKey(storageKey);
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: storageKey,
          Body: body,
        }),
      );
    },

    async getStream(storageKey: string): Promise<Readable> {
      assertSafeStorageKey(storageKey);
      const result = await client.send(
        new GetObjectCommand({
          Bucket: options.bucket,
          Key: storageKey,
        }),
      );
      const body = result.Body;
      if (!body) {
        throw new Error("S3 GetObject returned empty body");
      }
      return body as Readable;
    },

    async delete(storageKey: string): Promise<void> {
      assertSafeStorageKey(storageKey);
      await client.send(
        new DeleteObjectCommand({
          Bucket: options.bucket,
          Key: storageKey,
        }),
      );
    },
  };
}
