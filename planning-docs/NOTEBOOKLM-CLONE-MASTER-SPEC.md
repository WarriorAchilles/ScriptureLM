# ScriptureLM — NotebookLM-Style Research Assistant (Master Specification)

**Document purpose:** Single source of truth for project scope, architecture direction, and implementation boundaries. Detailed implementation plans and tickets will be derived from this file later.

**Last updated:** 2025-03-26 (architecture decisions recorded in §15)

---

## 0. Name and intent: ScriptureLM

**ScriptureLM** is the product name. It evokes studying **Scripture** in a **language-model**–assisted workflow (parallel to the “LM” pattern of tools like NotebookLM).

The Greek **Logos** (*λόγος*) remains the thematic backdrop: **Word**, **reason**, **divine wisdom**—not the English homograph “logo” (plural: logos as brand marks). That sense alludes especially to the opening of **St. John’s Gospel**, chapter 1, where the eternal Word is declared. **ScriptureLM** is a study aid for working **in text**: Scripture and related preaching, grounded in a **shared, curated source catalog** (see §5.2).

**Primary research goal:** ask questions about **doctrine and teaching** as it appears in that corpus—**the Bible** and **the sermon transcripts**—and receive answers **tied to retrieved passages**, not free-floating speculation.

---

## 1. Vision and summary

Build a **theological and doctrinal research workspace** (inspired by Google NotebookLM) where **every user** draws on the **same admin-curated source library**, **chats with it using retrieval-augmented generation (RAG)**, and **generates summaries grounded in those sources**. End users **do not** upload their own documents; they **browse** the catalog and **scope** queries to all or part of it. The initial deployment target is **AWS**, usage is **single-user (you)** for early deployment, and the primary model is **Anthropic Claude** for both chat and summarization.

### 1.1 Anchor corpus (shared library)

The canonical library is large and two-voiced; it is **maintained by operators/admins** and **visible identically** to all authenticated users:

| Corpus | Role | Scale (order of magnitude) |
|--------|------|----------------------------|
| **The Bible (full text)** | Normative Scripture — **KJV only** in v1 (see §15) | **One `Source` per book** (66 for Protestant canon); chunking strategy for verses is an implementation detail (see §12). |
| **Sermon transcripts — Rev. William Branham** | Secondary corpus: teaching as recorded in transcript form (colloquially **Brother Branham** / **Bro Branham**) | On the order of **~1,200** transcripts when fully ingested. |

You will use the app to ask questions such as what is taught **in Scripture**, what appears in **those sermons**, and how they **relate**—with retrieval and citations making the basis of each answer visible.

The system should be designed so that **scaling to multi-tenant SaaS** is possible later without rewriting core behaviors—but **MVP scope stays ruthlessly focused** on solo use.

---

## 2. Goals

| Goal | Description |
|------|-------------|
| **Multi-source knowledge base** | **One global source catalog** per deployment, **admin-managed**; **one conversation workspace per user** (see §5.1). Emphasize **unlimited sources** in the catalog at the product level (subject to fair infrastructure limits). |
| **RAG chat** | User asks questions; answers cite or are clearly grounded in retrieved chunks from sources. |
| **Source-grounded summarization** | Produce summaries (full doc, section-level, or **library overview**) with explicit ties to source content. |
| **File types (v1)** | **PDF**, **plain text**, and **Markdown** as first-class **admin ingest** paths (operators add material to the shared catalog). |
| **Familiar stack** | **React + Next.js** frontend; **AWS** for hosting and data services. |
| **Claude-first** | **Anthropic Claude** for generation (chat, summaries, optional structuring). Embeddings may use a separate model/service (see §6.3). |
| **Doctrinal Q&A over defined corpora** | Answers must be **grounded in the Bible and Branham transcripts in the shared catalog**; the UI and RAG layer should support **clear attribution** (which book, chapter, sermon, etc., when present in source metadata or extract). |

---

## 3. Non-goals (MVP)

To keep v1 shippable, explicitly **out of scope** unless promoted later:

- **Audio/video ingestion**, YouTube URLs, web crawl-at-scale, live Google Drive/Dropbox sync (may add “URL fetch” for single pages later if needed).
- **Multi-user collaboration**, shared notebooks, real-time co-editing.
- **NotebookLM parity** on UI polish, multi-modal studio, podcast generation, etc.
- **Fully automated legal/compliance review** of catalog files (**operators** own responsibility for what is ingested; see §3.1).
- **Per-user custom uploads** (v1): end users cannot add private documents to the library; only **admin/operator** workflows extend the corpus.
- **Guaranteed “unlimited” at any price point** in SaaS form—product can promise “no arbitrary cap” for personal use while infra enforces practical quotas.
- **Authoritative religious arbitration:** the tool **does not** replace pastors, denominations, or scholarly consensus; it **surfaces and summarizes text in the curated catalog**. Normative judgments remain the user’s.
- **Perfect OCR/audio reconstruction** for every historical recording variant (transcripts are treated as the loaded text; cleaning variants are a data-prep concern).

### 3.1 Content rights and editions (operator responsibility)

- **Bible text:** rights depend on **translation and publisher**; operators only load editions the deployment is **permitted** to host and redistribute to users in this context.
- **Sermon transcripts:** operators ensure **lawful right to store, index, and serve** the catalog to end users (own transcriptions, licensed collections, or public-domain where applicable). The application does not verify copyright.

---

## 4. Primary user and future SaaS posture

### 4.1 Now (single user)

- One logical **tenant**: you.
- Authentication can be minimal (e.g., password/API key behind VPN, or a single Cognito user) as long as **secrets and data are not public**.

### 4.2 Later (SaaS)

Design **data isolation** and **resource accounting** up front so you do not paint yourself into a corner:

- **Tenant ID** on all user-owned rows (even if unused in v1).
- Per-tenant **storage, embedding, and LLM token** metrics.
- **Rate limits** and **upload size** limits per plan.
- **Billing hooks** (Stripe, etc.) as a future layer—not required for MVP.

---

## 5. Functional requirements

### 5.1 Library (one notebook per user, shared source catalog)

- **Shared catalog:** the **source library** (Bible, sermons, any future admin-added works) is **global to the deployment**—**all users see the same sources**. There is no per-user duplicate of the corpus and no end-user upload into the library in v1.
- **Exactly one notebook per user** in v1—holds **chat state**, not ownership of sources. **v1 chat:** **single thread** per user (no thread list required for MVP); the data model may allow more threads later. The data model may still use a `Notebook` row for SaaS evolution, but the **product** exposes one conversation workspace per user while **pointing at** the shared catalog.
- **Default scope:** chat runs against the **full catalog** unless the user narrows it. New users do not “build” a library; they **inherit** the operator-maintained corpus.
- **Source-scoped retrieval:** the user can **narrow which sources** each question uses—e.g. **all catalog sources** (default), **Scripture-only**, **sermons-only**, or an **explicit subset** (one sermon, selected books of the Bible, or any checked list of catalog entries). Retrieval and citations must respect that selection.
- **Catalog status (UX):** show **read-only** indexing/health per source (same view for all users); **mutation** (add/remove/reindex) is **operator-only** via **non-UI** tooling (see §5.5).

### 5.2 Sources (admin-curated, read-only to users)

- **Scope:** **Source** rows describe **catalog entries** shared by the whole product. They are **not** owned by an individual user’s notebook; per-user scoping happens only at **query time** (which `source_id`s are active for this message).
- **Who adds sources:** only **admins/operators** (authenticated **admin** role, internal tooling, or controlled CI pipeline) may **create, update, delete, or re-ingest** sources—via PDF, `.txt`, `.md`, or future pipelines. **End users never upload** files into the corpus in v1.
- **Canonical content:** the **full Bible** and the **~1,200 sermon transcript** set are the flagship entries; additional admin-added works use the same **Source** / ingest mechanics.
- **Source list UX (end user):** **read-only** browse—**name, corpus tag** (`scripture` | `sermon` | `other`), **indexing status**, and enough identity (e.g. sermon title, Bible translation) to **select** sources for chat scope (§5.1). No delete/rename for ordinary users.
- **Extract text** reliably from PDFs **that already contain extractable text** (v1 **does not** target scanned/OCR PDFs; see §15).
- **Store originals** in object storage for reprocessing and audit (admin-only write access at the infrastructure layer where applicable).
- **Re-index:** operators trigger **per-source or full-catalog** reindex when extraction/chunking/embedding changes (with clear progress and pipeline version metadata).
- **Remove / deprecate source (operator-only):** use **scheduled deletion** (see §15): **soft-delete / hide** from catalog and queries immediately, record **scheduled hard-purge time** (rollback window), run a job to **purge** vectors + S3 at that time; operators can **force-delete** immediately to bypass the schedule when needed.

### 5.3 Chat (RAG)

- **Streaming responses** preferred for UX.
- **Retrieval** from the **shared catalog**, filtered by the **active source scope** for that message (see §5.1)—and scoped to what that user is allowed to query (in v1, **all catalog sources**; future plans may tier access): all sources, corpus preset, or **explicit list of `source_id`s**. Conversation context may still be keyed by **`notebook_id`** / user for threading only.
- **Source-aware retrieval (corpus this size):** with **all sources** selected, support narrowing or weighting by **corpus class** so answers can prioritize **Bible** when appropriate and avoid **many near-duplicate sermon chunks** crowding out Genesis–Revelation. When the user picks **individual sources**, retrieval is simply constrained to those IDs. Implementation may evolve: **metadata filters**, **hybrid search** (BM25 + vectors), **MMR**, or **re-ranking**.
- **Citations / provenance:** **inline citations** in the assistant reply (see §15)—tied to retrieved spans; for Bible chunks, **book + chapter + verse** where metadata allows; for sermons, **sermon identifier, title, date, or file name** as available.
- **Conversation memory**: short-term thread history sent to the model; optional compaction for long threads (later).
- **Refusal behavior**: when retrieval is empty or low-confidence, the assistant should say so rather than hallucinate.

### 5.4 Summarization

- **Per-source summary**: concise overview, key points, optional “study-guide” style.
- **Library-level brief** (whole workspace): synthesized across sources with attribution (respecting optional source scope if summarization supports it).
- **Controls**: length, audience (technical vs. plain), focus prompts.
- **Regeneration** with different parameters without duplicating stored sources.

### 5.5 Operator / admin operations (no admin UI in v1)

- **Source management** is done via **CLI, scripts, one-off jobs, or protected internal API routes**—**not** a dedicated operator web UI for MVP (see §15). Operators add/update/remove catalog entries, upload or register files in S3, trigger **ingest and reindex**, and inspect **per-job failures** / retry from the terminal or automation.
- **Access control:** operator entrypoints **must not** be exposed to normal end users (network isolation, secrets, IAM, or auth middleware); audit log of catalog changes (recommended).
- **Platform ops (solo MVP):** export or backup data (document list + blob export; full backup strategy can be phased).

---

## 6. Technical architecture

**Deployment posture (v1):** **monolith**—Next.js application owns HTTP UI + API, with optional **background worker in the same codebase** (e.g. SQS consumer in a second process/container from the same repo) rather than splitting into separate microservices (see §15).

### 6.1 High-level components

1. **Web app (Next.js)** — UI, auth session, server actions or API routes for CRUD.
2. **Ingestion pipeline** — parse PDF/text/md, normalize text, chunk, embed, upsert vectors.
3. **Retrieval service** — embedding query, vector search, optional re-ranking (future), assemble context window.
4. **LLM orchestration** — call Claude with system prompts, tools (if any), and retrieved context.
5. **Persistence** — relational metadata, object storage for files, vector store for chunks.
6. **Async jobs** — queue workers for ingest/embed (avoid blocking admin uploads or bulk ingest requests).

### 6.2 Recommended AWS mapping (illustrative)

**Recorded default (§15):** favor the **simplest AWS-native** stack for an operator new to vector DBs. **Compute** defaults to **AWS App Runner** (see §15); **ECS Fargate** remains an option if you later need fuller VPC orchestration or patterns App Runner does not support.

| Concern | AWS option |
|--------|------------|
| Compute (Next.js) | **AWS App Runner** — containerized Next.js (default per §15). **ECS Fargate** is an alternative for heavier VPC/service-mesh needs. **Lambda + API Gateway** is possible but can complicate long-running ingest and websockets/streaming. |
| Database (metadata **and** vectors) | **Amazon RDS (PostgreSQL) + pgvector** — one managed service for relational data and embeddings; minimal moving parts versus OpenSearch. |
| Object storage | **Amazon S3** — originals + optional extracted text artifacts. |
| Embeddings | **Amazon Bedrock** (e.g. **Amazon Titan Embeddings**) — stay in-region with RDS; confirm current model ID, dimensions, and quotas at implementation time. |
| Async jobs | **SQS** + worker on **App Runner** (second service or same image with different `CMD`) **or** lightweight **Step Functions** for orchestration if pipelines grow. |
| Auth (future-ready) | **Amazon Cognito** or **Auth.js** with credentials in RDS — Cognito if SaaS is likely. |
| Secrets | **AWS Secrets Manager** or **SSM Parameter Store**. |
| Observability | **CloudWatch** logs/metrics; optional **X-Ray** later. |
| CDN | **CloudFront** in front of **App Runner** as traffic grows (use an **Application Load Balancer** only if you adopt ECS or another target that requires it). |

**Single-tenancy shortcut for MVP:** One VPC, one RDS instance, one bucket with prefix isolation—even if you only use one prefix.

### 6.3 Models and APIs

- **Generation:** **Anthropic Messages API** (Claude). Use the latest stable family appropriate for your quality/cost tradeoff (implementation phase selects exact model IDs).
- **Embeddings (recorded):** **Amazon Bedrock — Titan Embeddings** (or successor) for **AWS-only, in-region** simplicity alongside pgvector; alternatives remain possible if quality tests fail. **Critical:** store `embedding_model` and dimensions with every vector for safe re-indexing.
- **Token/window limits:** Enforce max context from retrieval; summarize or truncate chunks deterministically with logging.

### 6.4 RAG pipeline (conceptual)

1. **Admin ingest** (upload or pipeline) → persist to S3 → record **global** `Source` row (`pending`).
2. **Extract** text (PDF library or managed extractor; **v1 assumes text-based PDFs**, no OCR pipeline).
3. **Normalize** (strip excessive whitespace, preserve structure for md).
4. **Chunk** with overlap; attach metadata: `source_id`, `filename`, `page` (if PDF), `chunk_index`, and **corpus tags** (e.g. `scripture` | `sermon` | `other`) plus **structured locators** where known. **Scripture:** one **Source** row **per Bible book** (KJV); `bible_book` + chapter/verse metadata as available. **Sermons:** `sermon_id` or `preached_date` from filenames or front-matter. Chunks are **not** duplicated per user.
5. **Embed** each chunk; upsert to vector store with same metadata for filtering.
6. **Mark** `Source` as `ready` or `failed` with error detail.

**Query path:** embed query → top-k retrieval (filter by **active `source_id` set / corpus filter** against the shared index) → optional MMR diversity → build prompt with citations → Claude stream. Optional `user_id` / `notebook_id` for logging or future ACL only.

### 6.5 Frontend (Next.js + React)

- **App Router** recommended (current Next.js default).
- **UI capabilities:** single **workspace** per user, **read-only source catalog** browse with status, **single chat thread** with streaming, **source scope** control (all / corpus preset / pick individual sources), summary views, basic settings (API keys should not live in client—server-side only). **No** end-user upload dropzone; **no** operator web UI for ingest in v1 (see §5.5).
- **Corpus-aware controls:** presets (e.g. **Scripture / Sermons / Both**) plus **per-source checkboxes or multi-select** for narrowing queries. Bible is **KJV** only in v1—no multi-translation selector required until the catalog changes.
- **Accessibility and UX:** keyboard-friendly chat, clear indexing errors; **admin** ingest flows show progress for long PDFs and **batch imports** (~1,200 sermons).

### 6.6 Security and privacy

- **Encryption at rest** for S3 and RDS; TLS in transit everywhere.
- **No Anthropic training** on your API traffic by default (confirm current Anthropic data policies in implementation docs).
- **Secrets** never committed; CI uses OIDC to AWS where possible.
- **SaaS path:** per-tenant KMS keys (optional), row-level security in Postgres, strict S3 prefix ACLs/IAM.

---

## 7. Data model (logical)

Entities (names indicative):

- **User** — id, email, auth subject, plan (future).
- **Notebook** — id, user_id, title, timestamps. **Constraint (v1 product):** at most **one** notebook per `user_id`. Holds **chat threads only**; does **not** own `Source` rows.
- **Source** — id, type (`pdf` | `text` | `markdown`), **corpus** (`scripture` | `sermon` | `other`), optional labels (e.g. `bible_translation` = **KJV** for scripture, `bible_book` for per-book rows, `sermon_catalog_id`), storage_key, byte_size, text_extraction_version, status, error_message, checksum, audit fields (`created_by`, timestamps). **Lifecycle:** `deleted_at` / **hidden** flag, **`purge_after` (scheduled hard delete)**, optional **`force_purge` / immediate purge** operator path (see §15). **Global catalog**—no `notebook_id`; shared across all users.
- **Chunk** — id, source_id, content, metadata (page, offsets), embedding_ref (or inline depending on store).
- **ChatThread** — id, notebook_id, title, created_at. **v1:** at most **one** thread per notebook (optional `UNIQUE(notebook_id)`).
- **Message** — id, thread_id, role, content, retrieval_debug (json, optional, admin-only).
- **Job** — id, type (`ingest` | `reindex`), payload, status, attempts.

Vector store may mirror **Chunk** identifiers for joins.

---

## 8. Quality, evaluation, and testing

- **Golden set:** fixed doctrinal and lexical questions with **expected supporting citations** (Bible references and specific sermon files or titles) to regression-test retrieval across **both corpora** and **Scripture-only** mode.
- **Metrics:** retrieval hit rate @k, user-marked “bad answer” feedback (later).
- **Tests:** unit tests for chunking and citation formatting; integration tests against a dev vector DB; smoke tests for **admin ingest** → query.

---

## 9. Observability and cost controls

- Structured logs for ingest steps, embedding counts, Claude token usage (input/output).
- Budget alarms on AWS + Anthropic usage.
- **Idempotency** on ingest jobs to avoid duplicate charges after retries.

---

## 10. Roadmap (suggested phases)

| Phase | Outcome |
|-------|---------|
| **Phase 0 — Spike** | Extract text from PDF + md, chunk, embed with chosen stack; prove end-to-end RAG Q&A via CLI or minimal UI. |
| **Phase 1 — MVP web** | Next.js UI, **shared catalog** (read-only in app) + **admin ingest** path + **source-scoped** chat + streaming + basic summaries; AWS deploy. |
| **Phase 2 — Hardening** | Better **inline** citations UX, failure/retry UX, backups, eval harness, rate limits; operator workflows can stay **CLI-first** or gain UI if needed. |
| **Phase 3 — SaaS foundations** | Cognito, multi-tenant schema enforcement, billing, **operator** console hardening (audit, roles). |

---

## 11. What it will take to build (honest scope overview)

**Rough effort for a capable solo developer familiar with AWS:**

- **Phase 0–1 (usable personal tool):** on the order of **several weeks of focused part-time work** to **a month or more full-time**, depending on PDF edge cases, citation quality bar, and how polished the UI must be on first release.
- **Hardening + SaaS-ready data model:** additional **weeks to months** as features and compliance expectations rise.

**Major time sinks:**

- **Corpus scale:** indexing **full Bible + ~1,200 transcripts** (embedding cost, storage, query latency, and UX for bulk status).
- **Retrieval balance:** preventing one corpus from **dominating** top-k results; **metadata and filters** are effectively required, not optional polish.
- **Verse- and sermon-level citations:** enriching chunks with **reference metadata** (from files, headings, or post-processing) so answers are quotable in a study workflow.
- PDF text extraction quality (scanned PDFs, tables, two-column layouts).
- Citation UX that is both trustworthy and readable.
- Async ingestion reliability (retries, poison messages, observability).
- ~~Choosing between **pgvector vs. managed vector DB**~~ — **Decided:** pgvector (§15).

---

## 12. Open decisions (remaining for implementation planning)

1. **Bible chunking within each book:** verse-aligned chunks vs. fixed token windows with overlap; how much context to include for readability vs. citation precision.
2. **Hybrid retrieval:** **v1 default is vector-only** (pgvector); **BM25 / keyword + vector** (e.g. OpenSearch or Postgres full-text) is **undecided**—revisit after measuring retrieval quality on sample doctrinal questions.
3. **Sermon metadata:** convention for filenames or front-matter so **sermon title / date** flow into citations without manual tagging of all ~1,200 files.
4. **Exact model IDs:** Claude **and** Bedrock embedding model variant at ship time (cost/latency/quality).

---

## 13. Success criteria (MVP)

- Operators ingest the **full Bible** and **on the order of ~1,200 Branham sermon transcripts** (as PDF/text/md) into the **shared catalog** with **visible progress** and **resumable/retryable** jobs; **all end users** see query results against that corpus.
- Ask **doctrine- and text-based questions** and receive answers that **reference Scripture and/or specific sermons** as retrieved; answers **gracefully degrade** when the corpus has no relevant passage.
- Optionally restrict chat to **Scripture-only** or **sermons-only** and still get coherent retrieval (filters work end-to-end).
- Generate a **source summary** and a **library overview** that are **usefully grounded** and reproducible with the same inputs.
- Deployed on **AWS** with **reasonable operational friction** (logs, retries, basic alarms).
- Codebase structured so **tenant_id** and per-tenant quotas can be added without a full rewrite.

---

## 14. Related documents (planned, not yet created)

Implementation breakdowns may include: `architecture-decisions.md`, `rag-pipeline.md`, `aws-runbook.md`, `frontend-ux.md`, `data-model.sql`, `security-checklist.md`. Those should **reference this master spec** (and §15) rather than duplicating scope.

---

## 15. Recorded architecture & product decisions

*These choices are locked for initial implementation breakdown unless a spike proves a technical blocker.*

| # | Topic | Decision |
|---|--------|----------|
| 1 | **Bible shape** | **Per-book `Source` rows** (Protestant canon: 66 books). **Translation:** **KJV only** for v1. |
| 2 | **Vector DB + embeddings (AWS, simplest)** | **Amazon RDS (PostgreSQL) + pgvector** for vectors and metadata together; **Amazon Bedrock — Titan Embeddings** (or current recommended successor) for embeddings in-region. |
| 3 | **Operator tooling** | **No dedicated admin web UI** for v1—**CLI / scripts / protected jobs** for ingest and catalog changes. |
| 4 | **Chat threads** | **Single thread** per user (one conversation surface in MVP). |
| 5 | **Deployment** | **Monolith**: Next.js app + optional worker from same codebase (not separate services). |
| 10 | **AWS compute** | **App Runner** for the Next.js service; **second App Runner** service (or same image, different `CMD`) for the SQS worker when needed. **ECS Fargate** only if you later need fuller VPC orchestration than App Runner provides. |
| 6 | **Citation presentation** | **Inline citations** in model replies (human-readable references next to claims). |
| 7 | **Hybrid search** | **Not decided** — start **vector-only**; add hybrid if eval shows need (see §12). |
| 8 | **PDFs** | **Text-native PDFs only** in v1; **no OCR** scope for MVP. |
| 9 | **Source deletion** | **Soft-delete / hide** immediately; **scheduled `purge_after`** for hard delete (vectors + S3); **operator force-delete** bypasses the wait when required. |

---

*End of master specification.*
