import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { listCatalogSourcesAllPages } from "@/lib/sources/list-catalog";
import { ThemeToggle } from "@/components/theme-toggle";
import { SummariesSurface } from "./summaries-surface";
import styles from "./summaries.module.css";

// Catalog state shifts whenever operators ingest or reindex; the initial
// dropdown must reflect the freshest READY list, so opt out of static caching.
export const dynamic = "force-dynamic";

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

  const catalog = await listCatalogSourcesAllPages();

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
        <div className={styles.headerAside}>
          <ThemeToggle variant="inline" />
          <Link href="/workspace" className={styles.backLink}>
            Back to workspace
          </Link>
        </div>
      </header>

      <SummariesSurface catalog={catalog} />
    </div>
  );
}
