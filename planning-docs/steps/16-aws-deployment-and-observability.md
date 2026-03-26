# Step 16: AWS deployment and observability

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.2 (AWS mapping), §6.6 (encryption, TLS), §9 (logs, budget alarms), §13 success criteria (deployed on AWS), §10 Phase 1 outcome.

## Manual actions (you must do)

- Provision **RDS PostgreSQL** with **pgvector** in your chosen region; configure **backups** and **parameter groups** as appropriate.
- Deploy **S3** buckets per environment; **encrypt** and block public access; set **lifecycle** if needed for cost (§6.6).
- Choose **App Runner** or **ECS Fargate** (§6.2) and wire **CI** (GitHub Actions or similar) with **OIDC** to AWS where possible (§6.6).
- Create **CloudWatch** log groups; optional **budgets/alerts** for Bedrock + Anthropic + RDS (§9).
- Run **TLS** termination at platform (HTTPS URL for users).

## Goal

The MVP runs **on AWS** behind HTTPS with **logs** and **basic operability**: you can deploy, roll back, and see failures without SSH guesswork (§13, §9).

## What you will build

- **Dockerfile(s)** for Next.js app and (if separate) worker; document **`DATABASE_URL`** and **worker** startup in compose/k8s/App Runner config.
- **Migrations** on deploy (job container or init task—pick a safe pattern).
- **Secrets** loaded from **Secrets Manager/SSM**, not baked into images (§6.6).
- **Smoke test** script: health check, auth sign-in, one RAG question against staging corpus (§8 testing note).

## Implementation notes

- **VPC** layout per §6.2 single-tenant shortcut; RDS in private subnets; compute in same VPC.
- **CloudFront** optional for MVP—add when needed (§6.2 CDN row).
- **Backup/export** is phased in §5.5—document manual snapshot path at minimum.

## Definition of done (testable)

- Public HTTPS URL loads the app; **protected routes** still enforce auth.
- **Staging** runs **full path**: ingest job → `ready` source → chat answer (can be scripted).
- **Logs** show structured lines for ingest, retrieval, and generation with **request correlation id**.
- **Budget or billing alarm** exists for your account or tagged resources (even a minimal budget alert counts for MVP ops).
