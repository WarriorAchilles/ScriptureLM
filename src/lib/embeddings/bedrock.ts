import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { getServerEnv } from "@/lib/config";

const TEXT_DECODER = new TextDecoder("utf-8");

export class EmbeddingDimensionMismatchError extends Error {
  constructor(
    message: string,
    public readonly receivedLength: number,
    public readonly expectedLength: number,
  ) {
    super(message);
    this.name = "EmbeddingDimensionMismatchError";
  }
}

function assertFiniteEmbeddingVector(
  values: number[],
  expectedDimensions: number,
): void {
  if (values.length !== expectedDimensions) {
    throw new EmbeddingDimensionMismatchError(
      `Embedding vector length ${values.length} does not match EMBEDDING_DIMENSIONS (${expectedDimensions}). ` +
        `Align BEDROCK_EMBEDDING_MODEL_ID / Titan request "dimensions" with the database vector column and EMBEDDING_DIMENSIONS.`,
      values.length,
      expectedDimensions,
    );
  }
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      throw new Error(
        `Embedding contains non-finite value at index ${index} (expected finite numbers only).`,
      );
    }
  }
}

function parseTitanEmbeddingResponse(
  output: InvokeModelCommandOutput,
  expectedDimensions: number,
): number[] {
  const body = output.body;
  if (!body) {
    throw new Error("Bedrock embedding response has no body.");
  }
  /** Bedrock returns `Uint8ArrayBlobAdapter` (bytes), not JSON text. */
  const jsonText = TEXT_DECODER.decode(body);
  const parsed = JSON.parse(jsonText) as {
    embedding?: number[];
    embeddingsByType?: { float?: number[] };
  };
  const vector =
    parsed.embedding ??
    parsed.embeddingsByType?.float ??
    null;
  if (!vector || !Array.isArray(vector)) {
    throw new Error(
      "Bedrock Titan embedding response missing `embedding` or `embeddingsByType.float`.",
    );
  }
  assertFiniteEmbeddingVector(vector, expectedDimensions);
  return vector;
}

function isRetryableBedrockError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String((error as { name?: string }).name) : "";
  if (
    name === "ThrottlingException" ||
    name === "ServiceUnavailableException" ||
    name === "ModelTimeoutException" ||
    name === "InternalServerException"
  ) {
    return true;
  }
  const status =
    "$metadata" in error &&
    error.$metadata &&
    typeof error.$metadata === "object" &&
    "httpStatusCode" in error.$metadata
      ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
      : undefined;
  if (status === 429 || status === 503 || status === 502) {
    return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retries transient Bedrock failures (throttling, 5xx) with exponential backoff (§9 prep).
 */
export async function withEmbeddingRetry<T>(
  operation: () => Promise<T>,
  options?: { maxAttempts?: number; label?: string },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 6;
  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= maxAttempts || !isRetryableBedrockError(error)) {
        throw error;
      }
      const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 30_000);
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

export type BedrockEmbeddingClient = Pick<BedrockRuntimeClient, "send">;

export type EmbedTextsBedrockOptions = Readonly<{
  /** Injected client (tests); default builds from `getServerEnv()` + AWS credential chain. */
  client?: BedrockEmbeddingClient;
  modelId?: string;
  region?: string;
  embeddingDimensions?: number;
  /** Titan `normalize` flag (default true). */
  normalize?: boolean;
  /** Max concurrent InvokeModel calls when embedding many strings (default 3). */
  maxConcurrency?: number;
}>;

function resolveBedrockEmbeddingOptions(
  options: EmbedTextsBedrockOptions,
): {
  client: BedrockEmbeddingClient;
  modelId: string;
  embeddingDimensions: number;
  normalize: boolean;
  maxConcurrency: number;
} {
  const env = getServerEnv();
  const modelId = options.modelId ?? env.bedrockEmbeddingModelId;
  const embeddingDimensions =
    options.embeddingDimensions ?? env.embeddingDimensions;
  if (!modelId) {
    throw new Error("Missing BEDROCK_EMBEDDING_MODEL_ID (server config).");
  }
  const client =
    options.client ??
    new BedrockRuntimeClient({
      region: options.region ?? env.awsRegion,
    });
  const normalize = options.normalize ?? true;
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 3);
  return {
    client,
    modelId,
    embeddingDimensions,
    normalize,
    maxConcurrency,
  };
}

async function embedOneText(
  client: BedrockEmbeddingClient,
  modelId: string,
  text: string,
  embeddingDimensions: number,
  normalize: boolean,
): Promise<number[]> {
  const body = JSON.stringify({
    inputText: text,
    dimensions: embeddingDimensions,
    normalize,
    embeddingTypes: ["float"],
  });
  const output = await withEmbeddingRetry(() =>
    client.send(
      new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: new TextEncoder().encode(body),
      }),
    ),
  );
  return parseTitanEmbeddingResponse(output, embeddingDimensions);
}

/**
 * Embeds one string via Amazon Titan Text Embeddings v2 (or compatible Bedrock model).
 */
export async function embedTextWithBedrock(
  text: string,
  options: EmbedTextsBedrockOptions = {},
): Promise<number[]> {
  const resolved = resolveBedrockEmbeddingOptions(options);
  return embedOneText(
    resolved.client,
    resolved.modelId,
    text,
    resolved.embeddingDimensions,
    resolved.normalize,
  );
}

/**
 * Embeds many strings (one InvokeModel per input; parallelized up to `maxConcurrency`).
 */
export async function embedTextsWithBedrock(
  texts: string[],
  options: EmbedTextsBedrockOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const resolved = resolveBedrockEmbeddingOptions(options);
  const results: number[][] = new Array(texts.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= texts.length) {
        return;
      }
      results[index] = await embedOneText(
        resolved.client,
        resolved.modelId,
        texts[index]!,
        resolved.embeddingDimensions,
        resolved.normalize,
      );
    }
  }

  const workers = Array.from(
    { length: Math.min(resolved.maxConcurrency, texts.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
