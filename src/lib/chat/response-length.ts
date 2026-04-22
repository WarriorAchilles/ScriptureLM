/**
 * Chat "answer length" tier: maps UI labels (short / medium / long) to Claude
 * model IDs for the Messages API. Parsed on the server from POST /api/chat/messages
 * so clients cannot supply arbitrary model strings.
 *
 * Model ids come from `getServerEnv()` (`ANTHROPIC_MODEL_HAIKU` / `_SONNET` /
 * `_OPUS`). Do not import `claudeModelForResponseLength` from client components.
 */

import { getServerEnv } from "@/lib/config";

export type ChatResponseLength = "short" | "medium" | "long";

export function parseChatResponseLength(
  raw: unknown,
):
  | { ok: true; value: ChatResponseLength | undefined }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (raw === "short" || raw === "medium" || raw === "long") {
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    error: '`responseLength` must be "short", "medium", or "long"',
  };
}

export function claudeModelForResponseLength(
  tier: ChatResponseLength,
): string {
  const env = getServerEnv();
  switch (tier) {
    case "short":
      return env.anthropicModelHaiku;
    case "medium":
      return env.anthropicModelSonnet;
    case "long":
      return env.anthropicModelOpus;
    default: {
      const exhaustive: never = tier;
      return exhaustive;
    }
  }
}
