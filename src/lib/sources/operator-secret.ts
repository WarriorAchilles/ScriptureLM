import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for operator shared secret (header vs env).
 */
export function isOperatorSecretValid(
  expectedFromEnv: string,
  headerValue: string | null,
): boolean {
  if (!expectedFromEnv || !headerValue) {
    return false;
  }
  const expected = Buffer.from(expectedFromEnv, "utf8");
  const received = Buffer.from(headerValue, "utf8");
  if (expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(expected, received);
}
