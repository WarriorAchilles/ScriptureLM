# ScriptureLM — implementation steps

This folder breaks the [master specification](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) into **ordered, testable steps**. Complete steps in sequence unless a step explicitly says it can run in parallel.

Each step (except **00**) is structured for a **human owner** plus an **AI coding agent**:

- **Manual actions (you must do)** — Things **you** do that are **not** writing application code: cloud consoles, IAM, billing, putting secrets in local env files, legal/compliance review, optional product choices, and running your machine’s prerequisites.
- **Instructions for the AI coding agent** — What the agent should **implement** in the repo: files, APIs, tests, and docs-as-code (e.g. `.env.example`). The agent should follow the [master spec](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) (especially **§15**) and match existing project conventions when present.

**Local database (default for this repo):** Day-to-day development targets **Postgres + pgvector in Docker** (`docker compose`). Optionally use a **cloud dev RDS** instance with the same migrations; the app uses **`DATABASE_URL`** — keep Docker there by default and swap to RDS only when you need AWS-parity checks. Details: root [`README.md`](../../README.md), Step [00](./00-prerequisites.md), Step [02](./02-local-postgres-pgvector.md).

**Local source files (default for this repo):** Catalog originals live on the **local filesystem** under **`SOURCE_STORAGE_ROOT`** (Step [06](./06-source-blob-storage.md)) during development; **Amazon S3** is the production backend after deploy (Step [16](./16-aws-deployment-and-observability.md)).

| Step | Focus |
|------|--------|
| [00-prerequisites.md](./00-prerequisites.md) | Accounts, tools, and decisions before implementation |
| [01-nextjs-monolith-scaffold.md](./01-nextjs-monolith-scaffold.md) | Runnable Next.js monolith shell |
| [02-local-postgres-pgvector.md](./02-local-postgres-pgvector.md) | PostgreSQL + pgvector locally |
| [03-core-relational-schema.md](./03-core-relational-schema.md) | Metadata tables per logical model |
| [04-configuration-and-secrets.md](./04-configuration-and-secrets.md) | Safe configuration boundaries |
| [05-authentication-single-user.md](./05-authentication-single-user.md) | Protected workspace for one user |
| [06-source-blob-storage.md](./06-source-blob-storage.md) | Source blob storage (local filesystem + S3) + `Source` persistence |
| [07-ingest-extract-chunk.md](./07-ingest-extract-chunk.md) | Text extraction and chunking |
| [08-embeddings-pgvector-upsert.md](./08-embeddings-pgvector-upsert.md) | Bedrock embeddings + vector rows |
| [09-async-ingest-jobs.md](./09-async-ingest-jobs.md) | Durable ingest/reindex jobs |
| [10-read-only-catalog-ui.md](./10-read-only-catalog-ui.md) | End-user catalog browse |
| [11-notebook-thread-messages.md](./11-notebook-thread-messages.md) | One notebook, one thread, chat history |
| [12-retrieval-service.md](./12-retrieval-service.md) | Scoped vector retrieval |
| [13-rag-chat-streaming.md](./13-rag-chat-streaming.md) | Claude streaming Q&A with citations |
| [14-source-scope-and-corpus-presets.md](./14-source-scope-and-corpus-presets.md) | Query narrowing in UI + API |
| [15-grounded-summarization.md](./15-grounded-summarization.md) | Source and library summaries |
| [16-aws-deployment-and-observability.md](./16-aws-deployment-and-observability.md) | AWS deploy, logs, alarms |

**Single source of truth for scope:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) (especially §15 for locked decisions).
