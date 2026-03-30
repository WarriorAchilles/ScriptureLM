-- Enable pgvector for embedding columns (master spec §6.2, §6.4).
-- Placeholder embedding dimensions and metadata-rich vector columns arrive when the app schema lands.
-- Nullable tenant_id on user-owned tables: Step 03 (SaaS evolution, spec §4.2).

CREATE EXTENSION IF NOT EXISTS vector;
