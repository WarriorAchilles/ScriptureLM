# Step 00: Prerequisites and environment

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — read §0–§4, §6.2–§6.3, §11, and §15 before any implementation work.

## Manual actions (you must do)

- Create or confirm an **AWS account** with permission to use **RDS**, **S3**, **Bedrock** (embeddings), **Secrets Manager** or **SSM**, and your chosen compute (**App Runner** or **ECS Fargate** per §6.2).
- Create an **Anthropic** account and ensure you can issue an API key for **Claude** (Messages API) when Step 13 needs it (§6.3).
- In the **Bedrock** console, **request model access** for **Titan Embeddings** (or the successor you will use). You will copy **model ID**, **region**, and **dimensions** into `.env.local` when the agent wires Step 08.
- Install **Node.js** (LTS), **Docker Desktop** (or a compatible engine), and **Git** on the machine where you run the app.
- **Local database posture (this project):** use **both** — **Docker Postgres + pgvector** for day-to-day development (fast, offline-capable), and optionally a **cloud dev RDS** instance when you need AWS-faithful behavior or shared dev data. The app reads a single active connection string (**`DATABASE_URL`**); put the Docker URL there by default and swap to your RDS URL only when intentionally testing against AWS (see Step 02 and root `README.md`). If you provision **dev RDS**, handle **network access** (security groups, VPN, or tunnel) yourself.
- Review **content licensing** for corpora you will load (§3.1); the app does not verify rights.

## Instructions for the AI coding agent

- **Do not** change application code for this step unless the human explicitly asks for a small onboarding link in an existing root `README`.
- When editing docs, treat **local dev** as **Docker Postgres primary** + **optional `DATABASE_URL_RDS_DEV`** (or equivalent) documented in `.env.example` per Step 02 — never imply RDS-only local dev.

## Definition of done (testable)

- `node -v` and `docker version` succeed on your machine.
- You can sign in to **Anthropic** and **AWS Bedrock** consoles without access errors.
- You have read the master spec sections above and accept **§15** decisions (pgvector + Titan embeddings, KJV per-book sources, no admin web UI in v1, single chat thread, inline citations, text-native PDFs only, soft-delete + scheduled purge for sources).
