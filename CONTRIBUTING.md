# Contributing notes

## Secrets and client bundles

Server-only secrets (Anthropic, AWS keys, `OPERATOR_INGEST_SECRET`, etc.) must never be referenced from client components or from code bundled for the browser.

Use `src/lib/config.ts` (`getServerEnv()`) only from Route Handlers, Server Actions, server components, and future worker code — not from files marked `"use client"`.

### Checklist (grep)

After adding or editing client components, ensure no server secrets are read from the client bundle. With [ripgrep](https://github.com/BurntSushi/ripgrep) installed, from the repo root:

```bash
rg '"use client"' src -l | xargs rg 'process\.env\.(ANTHROPIC|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|OPERATOR_INGEST_SECRET|AUTH_SECRET|NEXTAUTH_SECRET)' || true
```

On Windows PowerShell (no `xargs`), run the inner search manually on files you changed, or use Git Bash for the one-liner above. There should be no matches. Extend the alternation if new secret env names are added.
