/**
 * Integration tests: v1 DB uniqueness (see migration comment in
 * prisma/migrations/20260406194423_core_relational_schema/migration.sql).
 * Requires DATABASE_URL, Docker Postgres (or equivalent), and `npm run db:migrate:dev`.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("v1 uniqueness constraints (database-enforced)", () => {
  it("rejects a second notebook for the same user", async () => {
    const email = `uniq-nb-${Date.now()}@schema-test.local`;
    const user = await prisma.user.create({ data: { email } });
    await prisma.notebook.create({
      data: { userId: user.id, title: "First" },
    });

    await expect(
      prisma.notebook.create({
        data: { userId: user.id, title: "Second" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects a second chat thread for the same notebook", async () => {
    const email = `uniq-th-${Date.now()}@schema-test.local`;
    const user = await prisma.user.create({ data: { email } });
    const notebook = await prisma.notebook.create({
      data: { userId: user.id, title: "Notebook" },
    });
    await prisma.chatThread.create({
      data: { notebookId: notebook.id, title: "First" },
    });

    await expect(
      prisma.chatThread.create({
        data: { notebookId: notebook.id, title: "Second" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
