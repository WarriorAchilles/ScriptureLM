/**
 * Runs once per Next.js server process. Validates configuration in strict mode before
 * handling traffic (production or REQUIRE_FULL_ENV=1).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }
  const { assertStrictServerEnvOnStartup } = await import("@/lib/config");
  assertStrictServerEnvOnStartup();
}
