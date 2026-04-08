# Step 16: AWS deployment and observability

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.2, §6.6, §9, §13, §10 Phase 1.

## Manual actions (you must do)

- **Cutover from local dev:** development uses **filesystem** blob storage under **`SOURCE_STORAGE_ROOT`** (Step 06). For production, **provision S3**, set **`STORAGE_BACKEND=s3`** (or equivalent), point **`S3_BUCKET`** and IAM at the new bucket, and migrate or re-upload source objects as needed; **RDS** replaces Docker Postgres via **`DATABASE_URL`**.
- **Provision AWS**: RDS Postgres with **pgvector**, **S3 buckets** (production originals), IAM roles, **App Runner** for the Next.js service (and a **second App Runner** service for the **SQS worker** if you run it separately—same repo/image is fine), **VPC** subnets/security groups plus **App Runner VPC connector** if the app must reach **private RDS**, **Secrets Manager** or **SSM** parameters for prod secrets.
- **Register** your **GitHub** (or CI) **OIDC** trust in IAM if using OIDC deploys; add repo **secrets** the workflow needs (`AWS_ROLE_ARN`, etc.).
- Point your **DNS / HTTPS** at the deployed service (platform handles TLS cert or you attach ACM).
- In **AWS Billing**, create a **budget or cost anomaly alert** for the account or tagged resources (§9).
- **Run** the first production migration and smoke test **yourself** after first deploy (operator).

## Instructions for the AI coding agent

1. Add **`Dockerfile`** for Next.js **standalone** output (or documented multi-stage build) suitable for **App Runner**; if a **worker** exists, document a **second App Runner** service or **same image** with different `CMD` (`node worker.js`).
2. Add **`.dockerignore`**; ensure **no `.env`** copied into image (§6.6).
3. Add **GitHub Actions workflow** (or equivalent) that: lints/tests, builds image, pushes to **ECR** (optional), deploys via **OIDC**—use placeholders for ARNs the human fills in repo secrets.
4. Document **`DATABASE_URL`**, **`MIGRATE_ON_START=true`** pattern **or** separate **migration job**—pick **one** safe approach; include bash/psql or `npm run db:migrate` in entrypoint script with failure **non-zero** exit. In comments, distinguish **deployed** `DATABASE_URL` (RDS in AWS) from **local dev** (Docker primary, optional dev RDS swap — root `README.md`).
5. Add **`scripts/smoke-staging.ts`** (or shell): `GET /api/health`, optional **sign-in** cookie flow stub, one **chat** POST against staging URL with **env `SMOKE_BASE_URL`**—skip if no creds in CI.
6. Add **structured logging** helper if not present: **`correlationId`** middleware on API routes (header in + prop through retrieval + LLM logs) (§9).
7. In the **workflow YAML** (and `Dockerfile` comments where helpful), note **CloudWatch** log group naming, **RDS backup** expectation, and optional **S3 lifecycle**—do **not** add new markdown files unless the human asks for a runbook doc.

## Definition of done (testable)

- `docker build .` succeeds locally.
- CI workflow file **validates** (dry-run or act if available) and documents required **secrets**.
- Smoke script exits 0 against local or staging when env provided.
- Logs include **correlation id** on at least chat and ingest paths when those routes are hit.
