/**
 * Connectivity check against Postgres using DATABASE_URL (or DATABASE_URL_RDS_DEV with --rds).
 * Loads `.env.local` then `.env` like typical Next.js local setup.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const useRds = process.argv.includes("--rds");

async function main(): Promise<void> {
  if (useRds) {
    const rds = process.env.DATABASE_URL_RDS_DEV;
    if (!rds?.trim()) {
      console.log("db:check:rds: DATABASE_URL_RDS_DEV is not set; skipping.");
      process.exit(0);
    }
    process.env.DATABASE_URL = rds;
  }

  const url = process.env.DATABASE_URL;
  if (!url?.trim()) {
    console.error("Missing DATABASE_URL. Copy .env.example to .env.local and set DATABASE_URL.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1 AS ok`;
    console.log("Database connection OK.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
