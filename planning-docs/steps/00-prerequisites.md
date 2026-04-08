# Step 00: Prerequisites and environment

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — read §0–§4, §6.2–§6.3, §11, and §15 before any implementation work.

## Manual actions (you must do)

- **Local development** does **not** require an AWS account for **source file storage**: use a **local directory** (Step 06, **`SOURCE_STORAGE_ROOT`**) and **Docker Postgres** (Step 02). Create or confirm an **AWS account** when you are ready for **production deployment** (Step 16) or when you use **managed AWS services**—**RDS**, **S3** (production blobs), **Bedrock** (embeddings), **Secrets Manager** or **SSM**, and **App Runner** (plus **VPC connector** pieces if RDS is private) per §6.2 and §15.
- Create an **Anthropic** account and ensure you can issue an API key for **Claude** (Messages API) when Step 13 needs it (§6.3).
- In the **Bedrock** console, **request model access** for **Titan Embeddings** (or the successor you will use). You will copy **model ID**, **region**, and **dimensions** into `.env` when the agent wires Step 08.
- Install **Node.js** (LTS), **Docker Desktop** (or a compatible engine), and **Git** on the machine where you run the app.
- **Local database posture (this project):** use **both** — **Docker Postgres + pgvector** for day-to-day development (fast, offline-capable), and optionally a **cloud dev RDS** instance when you need AWS-faithful behavior or shared dev data. The app reads a single active connection string (**`DATABASE_URL`**); put the Docker URL there by default and swap to your RDS URL only when intentionally testing against AWS (see Step 02 and root `README.md`). If you provision **dev RDS**, handle **network access** (security groups, VPN, or tunnel) yourself.
- Review **content licensing** for corpora you will load (§3.1); the app does not verify rights.

## Instructions for the AI coding agent

- **Do not** change application code for this step unless the human explicitly asks for a small onboarding link in an existing root `README`.
- When editing docs, treat **local dev** as **Docker Postgres primary** + **optional `DATABASE_URL_RDS_DEV`** (or equivalent) documented in `.env.example` per Step 02 — never imply RDS-only local dev.

## Definition of done (testable)

- `node -v` and `docker version` succeed on your machine.
- You can access **Anthropic** for Claude. Before using **Bedrock embeddings** (Step 08), you can sign in to the **AWS Bedrock** console and complete model access for **Titan Embeddings** (or skip until you enable that step).
- You have read the master spec sections above and accept **§15** decisions (pgvector + Titan embeddings, **local filesystem blobs in dev + S3 in production** (§15 #11), KJV per-book sources, no admin web UI in v1, single chat thread, inline citations, text-native PDFs only, soft-delete + scheduled purge for sources).
