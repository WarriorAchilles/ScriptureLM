# Step 00: Prerequisites and environment

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — read §0–§4, §6.2–§6.3, §11, and §15 before writing code.

## Manual actions (you must do)

- Create or confirm an **AWS account** with permission to use **RDS**, **S3**, **Bedrock** (for embeddings), **Secrets Manager** or **SSM**, and your chosen compute (**App Runner** or **ECS Fargate** per §6.2).
- Create an **Anthropic** account and obtain API access for **Claude** (Messages API) for generation (§6.3).
- In Bedrock, **request model access** for **Titan Embeddings** (or the successor you will use); note **model ID**, **region**, and **embedding dimensions** when you implement Step 08.
- Install **Node.js** (LTS), **Docker Desktop** (or compatible engine) for local Postgres/pgvector, and **Git**.
- Decide your **local DB workflow** (Docker Compose vs. cloud dev RDS). Step 02 assumes a reproducible local database.
- Review **content licensing** for any corpus you will load (§3.1); the application does not verify rights.

## Goal

Eliminate blocked time later: credentials, quotas, and tooling are ready so Steps 01+ can run without mid-stream account work.

## What this step produces

- Documented **region choices**, **model IDs** (placeholders ok until Step 08), and where secrets will live.
- A short note (even in a private doc) listing **which AWS services** you will provision first for MVP.

## Definition of done (testable)

- You can run `node -v` and `docker version` successfully on your machine.
- Anthropic API and Bedrock console are accessible (you can open the Bedrock model catalog / Anthropic key UI without errors).
- You have read the master spec sections referenced above and agree with locked decisions in **§15** (pgvector, KJV per-book sources, no admin web UI in v1, single thread, inline citations).
