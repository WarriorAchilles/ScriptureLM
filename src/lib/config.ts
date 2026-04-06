/**
 * Server-only configuration: validated environment variables.
 *
 * Do **not** import this module from `"use client"` components or any client bundle.
 * Call sites (Route Handlers, Server Actions, server components, future worker) should
 * use `getServerEnv()` so values stay on the server.
 *
 * Step 16 (deployment): the same variable names can be populated from AWS Secrets Manager
 * or SSM Parameter Store in App Runner / ECS without changing this module’s API — inject
 * them into the process environment as today.
 */

export type ServerEnv = Readonly<{
  databaseUrl: string;
  /** Optional reference URL; app runtime still uses `databaseUrl` only (see README). */
  databaseUrlRdsDev: string;
  awsRegion: string;
  s3Bucket: string;
  bedrockEmbeddingModelId: string;
  anthropicApiKey: string;
  /** Session / JWT signing (Auth.js); `NEXTAUTH_SECRET` is still read as fallback. */
  authSecret: string;
  operatorIngestSecret: string;
  sqsQueueUrl: string;
  authGoogleId: string;
  authGoogleSecret: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsProfile: string;
}>;

const EMPTY = "";

function trimOrEmpty(value: string | undefined): string {
  return value?.trim() ?? EMPTY;
}

/** True when full env validation must pass before serving (prod build / explicit opt-in). */
export function isStrictEnvMode(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.REQUIRE_FULL_ENV === "1"
  );
}

/**
 * Returns true if the AWS SDK can resolve credentials (static keys, shared profile, or
 * role-based runtimes such as App Runner / Lambda).
 */
export function hasAwsCredentialChain(): boolean {
  const accessKeyId = trimOrEmpty(process.env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = trimOrEmpty(process.env.AWS_SECRET_ACCESS_KEY);
  if (accessKeyId && secretAccessKey) {
    return true;
  }
  if (trimOrEmpty(process.env.AWS_PROFILE)) {
    return true;
  }
  if (trimOrEmpty(process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI)) {
    return true;
  }
  if (trimOrEmpty(process.env.AWS_EXECUTION_ENV)) {
    return true;
  }
  if (trimOrEmpty(process.env.AWS_LAMBDA_FUNCTION_NAME)) {
    return true;
  }
  return false;
}

function resolveAuthSecret(): string {
  return (
    trimOrEmpty(process.env.AUTH_SECRET) ||
    trimOrEmpty(process.env.NEXTAUTH_SECRET)
  );
}

function missingName(name: string): Error {
  return new Error(`Missing required environment variable: ${name}`);
}

function assertNonEmpty(name: string, value: string): void {
  if (!value) {
    throw missingName(name);
  }
}

/**
 * Throws with a clear message (variable name or credential guidance) if strict mode
 * requirements are not met. Safe to call from instrumentation and check-env.
 */
export function assertStrictServerEnv(): void {
  assertNonEmpty("DATABASE_URL", trimOrEmpty(process.env.DATABASE_URL));

  assertNonEmpty("AWS_REGION", trimOrEmpty(process.env.AWS_REGION));
  assertNonEmpty("S3_BUCKET", trimOrEmpty(process.env.S3_BUCKET));
  assertNonEmpty(
    "BEDROCK_EMBEDDING_MODEL_ID",
    trimOrEmpty(process.env.BEDROCK_EMBEDDING_MODEL_ID),
  );
  assertNonEmpty(
    "ANTHROPIC_API_KEY",
    trimOrEmpty(process.env.ANTHROPIC_API_KEY),
  );
  assertNonEmpty("OPERATOR_INGEST_SECRET", trimOrEmpty(process.env.OPERATOR_INGEST_SECRET));

  const authSecret = resolveAuthSecret();
  if (!authSecret) {
    throw missingName("AUTH_SECRET (or NEXTAUTH_SECRET as fallback)");
  }

  if (!hasAwsCredentialChain()) {
    throw new Error(
      "Missing AWS credentials for strict mode: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, " +
        "or AWS_PROFILE (see AWS SDK config), or run with an IAM role (e.g. App Runner / Lambda).",
    );
  }
}

function assertMinimalDevServerEnv(): void {
  assertNonEmpty("DATABASE_URL", trimOrEmpty(process.env.DATABASE_URL));
}

function buildServerEnv(): ServerEnv {
  return {
    databaseUrl: trimOrEmpty(process.env.DATABASE_URL),
    databaseUrlRdsDev: trimOrEmpty(process.env.DATABASE_URL_RDS_DEV),
    awsRegion: trimOrEmpty(process.env.AWS_REGION),
    s3Bucket: trimOrEmpty(process.env.S3_BUCKET),
    bedrockEmbeddingModelId: trimOrEmpty(process.env.BEDROCK_EMBEDDING_MODEL_ID),
    anthropicApiKey: trimOrEmpty(process.env.ANTHROPIC_API_KEY),
    authSecret: resolveAuthSecret(),
    operatorIngestSecret: trimOrEmpty(process.env.OPERATOR_INGEST_SECRET),
    sqsQueueUrl: trimOrEmpty(process.env.SQS_QUEUE_URL),
    authGoogleId: trimOrEmpty(process.env.AUTH_GOOGLE_ID),
    authGoogleSecret: trimOrEmpty(process.env.AUTH_GOOGLE_SECRET),
    awsAccessKeyId: trimOrEmpty(process.env.AWS_ACCESS_KEY_ID),
    awsSecretAccessKey: trimOrEmpty(process.env.AWS_SECRET_ACCESS_KEY),
    awsProfile: trimOrEmpty(process.env.AWS_PROFILE),
  };
}

let cachedEnv: ServerEnv | undefined;

/**
 * Parsed, typed server environment. In `production` or when `REQUIRE_FULL_ENV=1`, all
 * strict fields must be set before this returns. In local dev otherwise, only
 * `DATABASE_URL` is required.
 */
export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }
  if (isStrictEnvMode()) {
    assertStrictServerEnv();
  } else {
    assertMinimalDevServerEnv();
  }
  cachedEnv = buildServerEnv();
  return cachedEnv;
}

let strictStartupValidated = false;

/** Next.js instrumentation entry: no-op in edge; validates once in Node when strict. */
export function assertStrictServerEnvOnStartup(): void {
  if (!isStrictEnvMode()) {
    return;
  }
  if (strictStartupValidated) {
    return;
  }
  assertStrictServerEnv();
  strictStartupValidated = true;
}
