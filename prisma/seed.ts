/**
 * Dev-only seed: user → notebook → chat thread → minimal global Source.
 * Run: `npm run db:seed` (requires `DATABASE_URL` and applied migrations).
 *
 * Set `SEED_USER_PASSWORD` to enable Credentials sign-in for the seed user
 * (bcrypt-hashed). The seed user is `admin` for future operator scripts.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const SEED_USER_EMAIL =
  process.env.SEED_USER_EMAIL ?? "dev@scripturelm.local";
const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD?.trim();
const SEED_SOURCE_STORAGE_KEY = "dev-seed/minimal-placeholder";
const BCRYPT_COST = 12;

async function main() {
  const passwordHash = SEED_USER_PASSWORD
    ? await bcrypt.hash(SEED_USER_PASSWORD, BCRYPT_COST)
    : undefined;

  const user = await prisma.user.upsert({
    where: { email: SEED_USER_EMAIL },
    update: {
      role: "admin",
      ...(passwordHash !== undefined ? { passwordHash } : {}),
    },
    create: {
      email: SEED_USER_EMAIL,
      role: "admin",
      ...(passwordHash !== undefined ? { passwordHash } : {}),
    },
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
