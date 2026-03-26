# Step 04: Configuration and secrets boundary

**Master spec:** [NOTEBOOKLM-CLONE-MASTER-SPEC.md](../NOTEBOOKLM-CLONE-MASTER-SPEC.md) — §6.6 (secrets, TLS), §6.5 (no client API keys), §9 (idempotency hooks later).

## Manual actions (you must do)

- Create **`.env.example`** listing every variable the app will need through MVP (database URL, AWS region, bucket name, Anthropic/Bedrock-related names, auth secrets).
- Configure local **`.env.local`** yourself (gitignored); never commit real keys.
- If using AWS locally, choose **named profiles** or **SSO** and document how developers authenticate for Bedrock/S3.

## Goal

The application **fails fast** in production-like modes when required configuration is missing, and **secrets never ship to the browser** (§6.5).

## What you will build

- A small **config module** (e.g. `lib/config.ts`) that validates environment variables at startup for server/runtime routes.
- Clear separation: **server-only** env for model keys and DB; **public** prefix only for truly public values (if any).
- CI check or script: `npm run check-env` that validates **presence** (not values) of required keys for `NODE_ENV=production`.

## Implementation notes

- Anthropic and Bedrock credentials must be reachable **only from server** code paths (Route Handlers, Server Actions, worker).
- Plan for **rotation**: loading from Secrets Manager/SSM in Step 16 should replace hardcoded env in deploy environments without code changes to call sites.

## Definition of done (testable)

- Running the app with **missing required env** produces a **clear startup error** (not an opaque 500 on first request).
- A **grep** or lint rule documents “no `process.env.ANTHROPIC` in client bundles” (or equivalent safeguard for your bundler).
- `.env.example` is complete enough that a new developer knows what to fill in after Step 00.
