import { type SourceCorpus, type SourceType } from "@prisma/client";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/config";
import { isOperatorSecretValid } from "@/lib/sources/operator-secret";
import { registerSourceFromBuffer } from "@/lib/sources/register-source";

export const runtime = "nodejs";

const SOURCE_TYPES = new Set<SourceType>(["pdf", "text", "markdown"]);
const CORPUS_VALUES = new Set<SourceCorpus>(["scripture", "sermon", "other"]);

function parseSourceType(raw: string | null): SourceType | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim() as SourceType;
  return SOURCE_TYPES.has(value) ? value : null;
}

function parseSourceCorpus(raw: string | null): SourceCorpus | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim() as SourceCorpus;
  return CORPUS_VALUES.has(value) ? value : null;
}

/**
 * Operator-only: multipart upload of a source file. Not exposed in end-user UI (master spec §5.2).
 * Header: `x-operator-secret` must match `OPERATOR_INGEST_SECRET`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  const secretHeader = request.headers.get("x-operator-secret");
  if (!isOperatorSecretValid(env.operatorIngestSecret, secretHeader)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing file field (must be a file upload)" },
      { status: 400 },
    );
  }

  const typeField = form.get("type");
  const corpusField = form.get("corpus");
  const type =
    typeof typeField === "string" ? parseSourceType(typeField) : null;
  const corpus =
    typeof corpusField === "string" ? parseSourceCorpus(corpusField) : null;
  if (!type || !corpus) {
    return NextResponse.json(
      {
        error:
          "Invalid or missing type/corpus. type: pdf|text|markdown; corpus: scripture|sermon|other",
      },
      { status: 400 },
    );
  }

  const bibleTranslationField = form.get("bible_translation");
  const bibleBookField = form.get("bible_book");
  const sermonCatalogIdField = form.get("sermon_catalog_id");
  const bibleTranslation =
    typeof bibleTranslationField === "string"
      ? bibleTranslationField.trim() || undefined
      : undefined;
  const bibleBook =
    typeof bibleBookField === "string"
      ? bibleBookField.trim() || undefined
      : undefined;
  const sermonCatalogId =
    typeof sermonCatalogIdField === "string"
      ? sermonCatalogIdField.trim() || undefined
      : undefined;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    const result = await registerSourceFromBuffer({
      buffer,
      originalFilename: file.name || "upload",
      type,
      corpus,
      bibleTranslation,
      bibleBook,
      sermonCatalogId,
    });

    return NextResponse.json({
      sourceId: result.sourceId,
      storageKey: result.storageKey,
      checksum: result.checksum,
      byteSize: result.byteSize,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[internal/sources/register]", message);
    return NextResponse.json(
      { error: "Failed to register source" },
      { status: 500 },
    );
  }
}
