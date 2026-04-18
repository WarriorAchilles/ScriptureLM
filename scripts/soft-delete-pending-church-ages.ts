/**
 * Soft-delete sermon `Source` rows stuck in PENDING when another non-deleted
 * sermon row exists with the same catalog title (`deriveSourceTitle`).
 *
 * Covers duplicate ingest (e.g. same transcript registered twice): keep READY,
 * remove the extra PENDING row and its chunks.
 *
 * Run: npx tsx scripts/soft-delete-pending-church-ages.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { deriveSourceTitle } from "../src/lib/sources/list-catalog";

config({ path: resolve(process.cwd(), ".env") });

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.source.findMany({
      where: { deletedAt: null, corpus: "sermon" },
      select: {
        id: true,
        status: true,
        sermonCatalogId: true,
        storageKey: true,
        bibleBook: true,
        bibleTranslation: true,
        corpus: true,
      },
    });

    const byTitle = new Map<string, typeof rows>();
    for (const row of rows) {
      const title = deriveSourceTitle(row);
      const bucket = byTitle.get(title);
      if (bucket) {
        bucket.push(row);
      } else {
        byTitle.set(title, [row]);
      }
    }

    const pendingIdsToRemove: string[] = [];
    for (const [title, group] of byTitle) {
      const pending = group.filter((row) => row.status === "PENDING");
      const ready = group.filter((row) => row.status === "READY");
      if (pending.length === 0 || ready.length === 0) {
        continue;
      }
      if (pending.length !== 1) {
        console.error(
          `Ambiguous duplicates for title "${title}": ${pending.length} PENDING, ${ready.length} READY — skip (fix manually).`,
        );
        continue;
      }
      pendingIdsToRemove.push(pending[0]!.id);
    }

    if (pendingIdsToRemove.length === 0) {
      console.log("No PENDING sermon sources with a READY duplicate title found; nothing to do.");
      return;
    }

    const now = new Date();
    for (const id of pendingIdsToRemove) {
      await prisma.$transaction(async (tx) => {
        await tx.chunk.deleteMany({ where: { sourceId: id } });
        await tx.source.update({
          where: { id },
          data: { deletedAt: now },
        });
      });
      console.log(`Soft-deleted PENDING duplicate source ${id}.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
