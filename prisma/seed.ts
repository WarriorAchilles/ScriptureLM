/**
 * Dev-only seed: user → notebook → chat thread → minimal global Source.
 * Run: `npm run db:seed` (requires `DATABASE_URL` and applied migrations).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_USER_EMAIL =
  process.env.SEED_USER_EMAIL ?? "dev@scripturelm.local";
const SEED_SOURCE_STORAGE_KEY = "dev-seed/minimal-placeholder";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: SEED_USER_EMAIL },
    update: {},
    create: { email: SEED_USER_EMAIL },
  });

  const notebook = await prisma.notebook.upsert({
    where: { userId: user.id },
    update: { title: "Dev notebook" },
    create: { userId: user.id, title: "Dev notebook" },
  });

  await prisma.chatThread.upsert({
    where: { notebookId: notebook.id },
    update: { title: "Main" },
    create: { notebookId: notebook.id, title: "Main" },
  });

  const existingSource = await prisma.source.findFirst({
    where: { storageKey: SEED_SOURCE_STORAGE_KEY },
  });

  if (!existingSource) {
    await prisma.source.create({
      data: {
        type: "markdown",
        corpus: "other",
        storageKey: SEED_SOURCE_STORAGE_KEY,
        status: "READY",
        byteSize: BigInt(0),
        textExtractionVersion: "seed",
        createdById: user.id,
      },
    });
  }

  console.log("Seed OK:", { userId: user.id, notebookId: notebook.id });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
