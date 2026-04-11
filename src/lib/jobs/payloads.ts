/** Stored in `Job.payload` for ingest / reindex jobs (Step 09). */
export type IngestJobPayload = Readonly<{
  source_id: string;
  pipeline_version: string;
}>;

export type ReindexJobPayload = Readonly<{
  source_id: string;
  pipeline_version: string;
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseIngestPayload(
  raw: unknown,
): { ok: true; value: IngestJobPayload } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: "payload must be a JSON object" };
  }
  const sourceId = raw.source_id;
  const pipelineVersion = raw.pipeline_version;
  if (typeof sourceId !== "string" || !sourceId.trim()) {
    return { ok: false, error: "payload.source_id must be a non-empty string" };
  }
  if (typeof pipelineVersion !== "string" || !pipelineVersion.trim()) {
    return {
      ok: false,
      error: "payload.pipeline_version must be a non-empty string",
    };
  }
  return {
    ok: true,
    value: {
      source_id: sourceId.trim(),
      pipeline_version: pipelineVersion.trim(),
    },
  };
}

export function parseReindexPayload(
  raw: unknown,
): { ok: true; value: ReindexJobPayload } | { ok: false; error: string } {
  return parseIngestPayload(raw) as
    | { ok: true; value: ReindexJobPayload }
    | { ok: false; error: string };
}

export function buildJobPayload(
  sourceId: string,
  pipelineVersion: string,
): IngestJobPayload {
  return {
    source_id: sourceId,
    pipeline_version: pipelineVersion,
  };
}
