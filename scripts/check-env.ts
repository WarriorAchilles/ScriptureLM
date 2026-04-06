/**
 * Verifies required environment variables are present without printing their values.
 * When NODE_ENV=production or REQUIRE_FULL_ENV=1, runs the same checks as server startup.
 * Otherwise exits 0 (nothing to verify).
 *
 * Loads `.env` from the project root when present (same as other scripts).
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import {
  assertStrictServerEnv,
  isStrictEnvMode,
} from "../src/lib/config";

config({ path: resolve(process.cwd(), ".env") });

function main(): void {
  if (!isStrictEnvMode()) {
    process.exit(0);
  }
  try {
    assertStrictServerEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
  process.exit(0);
}

main();
