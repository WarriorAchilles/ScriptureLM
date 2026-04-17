import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import {
  clampListLimit,
  listCatalogSources,
  type CatalogSourceSummary,
} from "@/lib/sources/list-catalog";
import styles from "./sources.module.css";

// Defer rendering to request time — the catalog changes whenever operators ingest/reindex,
// so a static cache would be stale by the time the user arrives.
export const dynamic = "force-dynamic";

type SearchParams = {
  cursor?: string | string[];
  limit?: string | string[];
};

/**
 * Read-only source catalog for the signed-in user (master spec §5.2).
 *
 * This is intentionally a Server Component loader (no client-side fetching) so the
 * first meaningful paint already contains the rows; the "Next page" link performs a
 * full navigation with the cursor encoded in the URL. That keeps the surface area
 * small for ~1,200 rows while leaving room to swap in virtualization later if users
 * drill through the full catalog (see spec §11 perf notes).
 */
export default async function SourcesCatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }

  const params = await searchParams;
  const rawCursor = firstParam(params.cursor);
  const rawLimit = firstParam(params.limit);
  const limit = clampListLimit(rawLimit ? Number(rawLimit) : undefined);

  const page = await listCatalogSources({ limit, cursor: rawCursor });

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Workspace</p>
          <h1 className={styles.title}>Source catalog</h1>
          <p className={styles.lead}>
            A curated library of Scripture and sermon transcripts, shared across the
            deployment. Browse what&rsquo;s available; scoping for chat arrives in a
            later step.
          </p>
        </div>
        <Link href="/workspace" className={styles.backLink}>
          Back to workspace
        </Link>
      </header>

      <main className={styles.main} aria-labelledby="sources-heading">
        <h2 id="sources-heading" className={styles.sectionTitle}>
          Catalog entries
        </h2>

        {page.items.length === 0 ? (
          <EmptyState />
        ) : (
          <SourcesTable items={page.items} />
        )}

        <Pagination
          limit={limit}
          nextCursor={page.nextCursor}
          itemCount={page.items.length}
        />
      </main>
    </div>
  );
}

function SourcesTable({ items }: { items: CatalogSourceSummary[] }) {
  return (
    <div className={styles.tableWrap} role="region" aria-label="Source catalog">
      <table className={styles.table}>
        <caption className={styles.caption}>
          {items.length} {items.length === 1 ? "source" : "sources"} on this page.
          This list is read-only; operators manage ingest through internal tooling.
        </caption>
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Corpus</th>
            <th scope="col">Status</th>
            <th scope="col">Details</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((source) => (
            <tr key={source.id}>
              <th scope="row" className={styles.titleCell}>
                {source.title}
              </th>
              <td>
                <span className={`${styles.corpus} ${corpusClass(source.corpus)}`}>
                  {source.corpus}
                </span>
              </td>
              <td>
                <StatusBadge status={source.status} />
              </td>
              <td className={styles.detailsCell}>
                {source.status === "FAILED" && source.errorMessage ? (
                  <span className={styles.errorSnippet} role="alert">
                    {source.errorMessage}
                  </span>
                ) : (
                  <span className={styles.muted}>—</span>
                )}
              </td>
              <td>
                <time dateTime={source.updatedAt}>
                  {formatUpdated(source.updatedAt)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: CatalogSourceSummary["status"] }) {
  const label =
    status === "PENDING"
      ? "pending"
      : status === "PROCESSING"
        ? "processing"
        : status === "READY"
          ? "ready"
          : "failed";
  const tone =
    status === "READY"
      ? styles.badgeReady
      : status === "FAILED"
        ? styles.badgeFailed
        : styles.badgePending;

  return (
    <span className={`${styles.badge} ${tone}`} aria-label={`Status: ${label}`}>
      <span className={styles.badgeDot} aria-hidden="true" />
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className={styles.empty} role="status" aria-live="polite">
      <p className={styles.emptyTitle}>The catalog is quiet.</p>
      <p className={styles.emptyBody}>
        No sources have been indexed yet. Once an operator registers Scripture or
        sermon transcripts, they&rsquo;ll appear here for every user in this
        workspace.
      </p>
    </div>
  );
}

function Pagination({
  limit,
  nextCursor,
  itemCount,
}: {
  limit: number;
  nextCursor: string | null;
  itemCount: number;
}) {
  if (!nextCursor) {
    return (
      <p className={styles.pageFoot} aria-live="polite">
        {itemCount > 0 ? "End of catalog." : null}
      </p>
    );
  }

  const params = new URLSearchParams({ cursor: nextCursor, limit: String(limit) });
  return (
    <nav className={styles.pageNav} aria-label="Catalog pagination">
      <Link
        href={`/workspace/sources?${params.toString()}`}
        className={styles.pageLink}
        prefetch={false}
      >
        Next page →
      </Link>
      {/*
        Perf note (spec §11): the catalog is expected to grow toward ~1,200 rows. Keyset
        pagination keeps queries O(log N); when a user actually needs to scan all rows on
        one page, swap this link for client-side virtualization (e.g. react-virtual) and
        call `/api/sources?cursor=...` incrementally.
      */}
    </nav>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function corpusClass(corpus: CatalogSourceSummary["corpus"]): string {
  if (corpus === "scripture") {
    return styles.corpusScripture;
  }
  if (corpus === "sermon") {
    return styles.corpusSermon;
  }
  return styles.corpusOther;
}

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
