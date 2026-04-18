import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import {
  clampListLimit,
  listCatalogSources,
  type CatalogSourceSummary,
} from "@/lib/sources/list-catalog";
import { PageSizeSelect } from "./page-size-select";
import styles from "./sources.module.css";

// Defer rendering to request time — the catalog changes whenever operators ingest/reindex,
// so a static cache would be stale by the time the user arrives.
export const dynamic = "force-dynamic";

type SearchParams = {
  cursor?: string | string[];
  limit?: string | string[];
  // Breadcrumb of cursors for pages visited before the current one, most-recent last.
  // Comma-separated; base64url cursors never contain commas so splitting is safe.
  // Page 1 is represented implicitly by an empty trail with no `cursor` param.
  trail?: string | string[];
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
  const rawTrail = firstParam(params.trail);
  const limit = clampListLimit(rawLimit ? Number(rawLimit) : undefined);
  const trail = parseTrail(rawTrail);

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
        <div className={styles.sectionHeader}>
          <h2 id="sources-heading" className={styles.sectionTitle}>
            Catalog entries
          </h2>
          <PageSizeSelect value={limit} />
        </div>

        {page.items.length === 0 ? (
          <EmptyState />
        ) : (
          <SourcesTable items={page.items} />
        )}

        <Pagination
          limit={limit}
          currentCursor={rawCursor ?? null}
          nextCursor={page.nextCursor}
          trail={trail}
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

/**
 * Pagination for keyset-paginated catalog pages.
 *
 * Forward-only keyset cursors can't be reversed, so "Previous" is implemented by
 * remembering the trail of cursors the user walked through. The current page's
 * starting cursor lives in `?cursor=`; the cursors of every earlier page (page 2,
 * page 3, ...) are appended to `?trail=`. Page 1 is represented by both being
 * absent. Going back pops the last trail entry and promotes it to `cursor`.
 */
function Pagination({
  limit,
  currentCursor,
  nextCursor,
  trail,
  itemCount,
}: {
  limit: number;
  currentCursor: string | null;
  nextCursor: string | null;
  trail: string[];
  itemCount: number;
}) {
  const hasPrevious = currentCursor !== null;
  const hasNext = nextCursor !== null;

  if (!hasPrevious && !hasNext) {
    return (
      <p className={styles.pageFoot} aria-live="polite">
        {itemCount > 0 ? "End of catalog." : null}
      </p>
    );
  }

  const previousHref = hasPrevious ? buildPreviousHref(limit, trail) : null;
  const nextHref = hasNext
    ? buildNextHref(limit, nextCursor, trail, currentCursor)
    : null;

  return (
    <nav className={styles.pageNav} aria-label="Catalog pagination">
      {previousHref ? (
        <Link
          href={previousHref}
          className={styles.pageLink}
          prefetch={false}
          rel="prev"
        >
          ← Previous page
        </Link>
      ) : (
        <span className={`${styles.pageLink} ${styles.pageLinkDisabled}`} aria-hidden="true">
          ← Previous page
        </span>
      )}

      {nextHref ? (
        <Link
          href={nextHref}
          className={styles.pageLink}
          prefetch={false}
          rel="next"
        >
          Next page →
        </Link>
      ) : (
        <span className={`${styles.pageLink} ${styles.pageLinkDisabled}`} aria-hidden="true">
          Next page →
        </span>
      )}
      {/*
        Perf note (spec §11): the catalog is expected to grow toward ~1,200 rows. Keyset
        pagination keeps queries O(log N); when a user actually needs to scan all rows on
        one page, swap this link for client-side virtualization (e.g. react-virtual) and
        call `/api/sources?cursor=...` incrementally.
      */}
    </nav>
  );
}

function buildNextHref(
  limit: number,
  nextCursor: string,
  trail: string[],
  currentCursor: string | null,
): string {
  // When advancing, the current page's cursor becomes the newest trail entry so
  // we can walk back to it later. Page 1 (currentCursor === null) contributes no
  // trail entry since it's the implicit base case.
  const nextTrail = currentCursor !== null ? [...trail, currentCursor] : trail;
  const params = new URLSearchParams({
    cursor: nextCursor,
    limit: String(limit),
  });
  if (nextTrail.length > 0) {
    params.set("trail", nextTrail.join(","));
  }
  return `/workspace/sources?${params.toString()}`;
}

function buildPreviousHref(limit: number, trail: string[]): string {
  // Pop the newest trail entry to use as the previous page's cursor. An empty
  // trail means the previous page is page 1 (no cursor param).
  const previousTrail = trail.slice(0, -1);
  const previousCursor = trail.length > 0 ? trail[trail.length - 1] : null;

  const params = new URLSearchParams({ limit: String(limit) });
  if (previousCursor) {
    params.set("cursor", previousCursor);
  }
  if (previousTrail.length > 0) {
    params.set("trail", previousTrail.join(","));
  }
  return `/workspace/sources?${params.toString()}`;
}

function parseTrail(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw.split(",").filter((entry) => entry.length > 0);
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
