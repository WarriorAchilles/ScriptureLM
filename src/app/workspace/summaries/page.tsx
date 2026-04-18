import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { listCatalogSources } from "@/lib/sources/list-catalog";
import { SummariesSurface } from "./summaries-surface";
import styles from "./summaries.module.css";

// Catalog state shifts whenever operators ingest or reindex; the initial
// dropdown must reflect the freshest READY list, so opt out of static caching.
export const dynamic = "force-dynamic";

// Step 15 agent default: "Summaries sub-route under workspace" (§5.4).
// Catalog ceiling is the same as the chat scope picker's; the form's
// per-source dropdown only uses READY entries.
const SUMMARY_CATALOG_LIMIT = 200;

/**
 * Grounded summarization UI (Step 15 #3; master spec §5.4).
 *
 * Offers two tabs:
 *  - Per-source summary: pick one READY source, choose length/audience/focus,
 *    Regenerate to re-post with the same or edited params.
 *  - Library brief: summarize across the full catalog, a corpus preset, or a
 *    multi-select of source ids. Same length/audience/focus controls.
 *
 * Summaries are ephemeral in v1 — the response is rendered inline and never
 * persisted (§5.4 "Regeneration with different parameters without duplicating
 * stored sources"). Clicking Regenerate simply re-runs the POST.
 */
export default async function SummariesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  const catalog = await listCatalogSources({ limit: SUMMARY_CATALOG_LIMIT });

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Workspace</p>
          <h1 className={styles.title}>Summaries</h1>
          <p className={styles.lead}>
            Generate grounded briefs for a single source or across the whole
            library. Every summary ends with a Sources line that names the
            contributing material.
          </p>
        </div>
        <Link href="/workspace" className={styles.backLink}>
          Back to workspace
        </Link>
      </header>

      <SummariesSurface catalog={catalog.items} />
    </div>
  );
}
