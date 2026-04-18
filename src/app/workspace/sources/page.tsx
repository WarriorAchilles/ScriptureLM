import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import {
  clampListLimit,
  countCatalogSources,
  listCatalogSources,
  type CatalogSourceSummary,
} from "@/lib/sources/list-catalog";
import {
  CAB_FOLDER_DESCRIPTION,
  catalogPathBreadcrumbTrail,
  formatCatalogPath,
  isCatalogLeafPath,
  parseCatalogPath,
  type ParsedCatalogPath,
} from "@/lib/sources/catalog-folders";
import {
  clampCatalogPage,
  listCatalogFolderPage,
  loadCatalogFolderIndex,
  parseCatalogSortParams,
} from "@/lib/sources/catalog-browse";
import { PageSizeSelect } from "./page-size-select";
import { CatalogSortSelect } from "./catalog-sort-select";
import styles from "./sources.module.css";

export const dynamic = "force-dynamic";

type SearchParams = {
  cursor?: string | string[];
  limit?: string | string[];
  trail?: string | string[];
  path?: string | string[];
  flat?: string | string[];
  page?: string | string[];
  sort?: string | string[];
  order?: string | string[];
};

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
  const flat = firstParam(params.flat) === "1";
  const pathParam = firstParam(params.path);
  const parsedPath = parseCatalogPath(pathParam);
  const rawLimit = firstParam(params.limit);
  const rawCursor = firstParam(params.cursor);
  const rawTrail = firstParam(params.trail);
  const rawPage = firstParam(params.page);
  const limit = clampListLimit(rawLimit ? Number(rawLimit) : undefined);
  const trail = parseTrail(rawTrail);
  const pageNum = clampCatalogPage(rawPage ? Number(rawPage) : undefined);
  const { sort, order } = parseCatalogSortParams(
    firstParam(params.sort),
    firstParam(params.order),
  );

  if (flat) {
    const [page, totalSources] = await Promise.all([
      listCatalogSources({ limit, cursor: rawCursor }),
      countCatalogSources(),
    ]);

    return (
      <CatalogShell totalSources={totalSources} showFlatToggle flatActive>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionHeaderIntro}>
            <h2 id="sources-heading" className={styles.sectionTitle}>
              All sources (flat)
            </h2>
            <p className={styles.catalogTotal} aria-live="polite">
              {totalSources.toLocaleString()}{" "}
              {totalSources === 1 ? "source" : "sources"} total
            </p>
          </div>
          <PageSizeSelect value={limit} />
        </div>

        {page.items.length === 0 ? (
          <EmptyState />
        ) : (
          <SourcesTable items={page.items} />
        )}

        <KeysetPagination
          limit={limit}
          currentCursor={rawCursor ?? null}
          nextCursor={page.nextCursor}
          trail={trail}
          itemCount={page.items.length}
        />
      </CatalogShell>
    );
  }

  if (parsedPath.kind === "root") {
    const index = await loadCatalogFolderIndex();
    return (
      <CatalogShell totalSources={index.totalSources} showFlatToggle flatActive={false}>
        <FolderBrowseHeader parsedPath={parsedPath} />
        <section aria-labelledby="sources-heading">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionHeaderIntro}>
              <h2 id="sources-heading" className={styles.sectionTitle}>
                Browse by folder
              </h2>
              <p className={styles.catalogTotal} aria-live="polite">
                {index.totalSources.toLocaleString()}{" "}
                {index.totalSources === 1 ? "source" : "sources"} total
              </p>
            </div>
          </div>
          <div className={styles.folderGrid}>
            <FolderCard
              href={folderHref("bible", { limit })}
              title="The Bible"
              count={index.bibleCount}
              subtitle="Scripture"
            />
            <FolderCard
              href={folderHref("message", { limit })}
              title="The Message"
              count={index.messageCount}
              subtitle="Sermons and message transcripts"
            />
          </div>
          {index.otherCount > 0 ? (
            <p className={styles.catalogTotal} role="note">
              {index.otherCount.toLocaleString()}{" "}
              {index.otherCount === 1 ? "source" : "sources"} use the <em>other</em> corpus
              (not scripture or sermon). Browse them in the{" "}
              <Link href="/workspace/sources?flat=1" className={styles.viewToggleLink}>
                flat table
              </Link>
              .
            </p>
          ) : null}
        </section>
      </CatalogShell>
    );
  }

  if (parsedPath.kind === "bible") {
    const index = await loadCatalogFolderIndex();
    return (
      <CatalogShell totalSources={index.totalSources} showFlatToggle flatActive={false}>
        <FolderBrowseHeader parsedPath={parsedPath} />
        <section aria-labelledby="sources-heading">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionHeaderIntro}>
              <h2 id="sources-heading" className={styles.sectionTitle}>
                The Bible
              </h2>
              <p className={styles.catalogTotal} aria-live="polite">
                {index.bibleCount.toLocaleString()}{" "}
                {index.bibleCount === 1 ? "source" : "sources"}
              </p>
            </div>
          </div>
          <div className={styles.folderGrid}>
            <FolderCard
              href={folderHref("bible/ot", { limit })}
              title="The Old Testament"
              count={index.bibleOldTestamentCount}
              subtitle="Scripture — Hebrew Bible and writings to Malachi"
            />
            <FolderCard
              href={folderHref("bible/nt", { limit })}
              title="The New Testament"
              count={index.bibleNewTestamentCount}
              subtitle="Scripture — Gospels through Revelation"
            />
          </div>
          {index.bibleUnspecifiedCount > 0 ? (
            <div className={styles.subfolderSection}>
              <h3 className={styles.subfolderTitle}>No book set</h3>
              <div className={styles.folderGrid}>
                <FolderCard
                  href={folderHref(
                    formatCatalogPath({
                      kind: "bible-book",
                      bookLabel: "Unspecified",
                    }),
                    { limit },
                  )}
                  title="Unspecified"
                  count={index.bibleUnspecifiedCount}
                  subtitle="Sources without a bible book field"
                />
              </div>
            </div>
          ) : null}
          {index.bibleBooksUnknown.length > 0 ? (
            <div className={styles.subfolderSection}>
              <h3 className={styles.subfolderTitle}>Other book names</h3>
              <p className={styles.catalogTotal}>
                These labels are not in the standard OT/NT list; open a book to browse
                sources.
              </p>
              <div className={styles.folderGrid}>
                {index.bibleBooksUnknown.map((entry) => (
                  <FolderCard
                    key={entry.label}
                    href={folderHref(
                      formatCatalogPath({
                        kind: "bible-book",
                        bookLabel: entry.label,
                      }),
                      { limit },
                    )}
                    title={entry.label}
                    count={entry.count}
                    subtitle="Open book"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </CatalogShell>
    );
  }

  if (parsedPath.kind === "bible-ot") {
    const index = await loadCatalogFolderIndex();
    return (
      <CatalogShell totalSources={index.totalSources} showFlatToggle flatActive={false}>
        <FolderBrowseHeader parsedPath={parsedPath} />
        <section aria-labelledby="sources-heading">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionHeaderIntro}>
              <h2 id="sources-heading" className={styles.sectionTitle}>
                The Old Testament — by book
              </h2>
              <p className={styles.catalogTotal} aria-live="polite">
                {index.bibleOldTestamentCount.toLocaleString()}{" "}
                {index.bibleOldTestamentCount === 1 ? "source" : "sources"}
              </p>
            </div>
          </div>
          {index.bibleBooksOld.length === 0 ? (
            <p className={styles.catalogTotal}>No Old Testament sources indexed yet.</p>
          ) : (
            <div className={styles.folderGrid}>
              {index.bibleBooksOld.map((entry) => (
                <FolderCard
                  key={entry.label}
                  href={folderHref(
                    formatCatalogPath({
                      kind: "bible-book",
                      testament: "ot",
                      bookLabel: entry.label,
                    }),
                    { limit },
                  )}
                  title={entry.label}
                  count={entry.count}
                  subtitle="Open book"
                />
              ))}
            </div>
          )}
        </section>
      </CatalogShell>
    );
  }

  if (parsedPath.kind === "bible-nt") {
    const index = await loadCatalogFolderIndex();
    return (
      <CatalogShell totalSources={index.totalSources} showFlatToggle flatActive={false}>
        <FolderBrowseHeader parsedPath={parsedPath} />
        <section aria-labelledby="sources-heading">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionHeaderIntro}>
              <h2 id="sources-heading" className={styles.sectionTitle}>
                The New Testament — by book
              </h2>
              <p className={styles.catalogTotal} aria-live="polite">
                {index.bibleNewTestamentCount.toLocaleString()}{" "}
                {index.bibleNewTestamentCount === 1 ? "source" : "sources"}
              </p>
            </div>
          </div>
          {index.bibleBooksNew.length === 0 ? (
            <p className={styles.catalogTotal}>No New Testament sources indexed yet.</p>
          ) : (
            <div className={styles.folderGrid}>
              {index.bibleBooksNew.map((entry) => (
                <FolderCard
                  key={entry.label}
                  href={folderHref(
                    formatCatalogPath({
                      kind: "bible-book",
                      testament: "nt",
                      bookLabel: entry.label,
                    }),
                    { limit },
                  )}
                  title={entry.label}
                  count={entry.count}
                  subtitle="Open book"
                />
              ))}
            </div>
          )}
        </section>
      </CatalogShell>
    );
  }

  if (parsedPath.kind === "message") {
    const index = await loadCatalogFolderIndex();
    return (
      <CatalogShell totalSources={index.totalSources} showFlatToggle flatActive={false}>
        <FolderBrowseHeader parsedPath={parsedPath} />
        <section aria-labelledby="sources-heading">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionHeaderIntro}>
              <h2 id="sources-heading" className={styles.sectionTitle}>
                The Message
              </h2>
              <p className={styles.catalogTotal} aria-live="polite">
                {index.messageCount.toLocaleString()}{" "}
                {index.messageCount === 1 ? "source" : "sources"} (all sermons)
              </p>
            </div>
          </div>
          {index.messageCount === 0 ? (
            <p className={styles.catalogTotal}>No sermon sources indexed yet.</p>
          ) : (
            <div className={styles.folderGrid}>
              {index.transcriptCount > 0 ? (
                <FolderCard
                  href={folderHref("message/cab", { limit })}
                  title="CAB"
                  count={index.transcriptCount}
                  subtitle={CAB_FOLDER_DESCRIPTION}
                />
              ) : null}
              {index.sermonYears.map((entry) => (
                <FolderCard
                  key={entry.year}
                  href={folderHref(`message/${entry.year}`, { limit })}
                  title={String(entry.year)}
                  count={entry.count}
                  subtitle="Dated message codes (e.g. 64-0216E)"
                />
              ))}
            </div>
          )}
        </section>
      </CatalogShell>
    );
  }

  if (isCatalogLeafPath(parsedPath)) {
    const folderPage = await listCatalogFolderPage({
      path: parsedPath,
      limit,
      page: pageNum,
      sort,
      order,
    });

    const start = folderPage.totalCount === 0 ? 0 : (folderPage.page - 1) * folderPage.pageSize + 1;
    const end = Math.min(
      folderPage.totalCount,
      folderPage.page * folderPage.pageSize,
    );
    const totalPages = Math.max(
      1,
      Math.ceil(folderPage.totalCount / folderPage.pageSize),
    );

    return (
      <CatalogShell
        totalSources={folderPage.totalCount}
        showFlatToggle
        flatActive={false}
      >
        <FolderBrowseHeader parsedPath={parsedPath} />
        <main aria-labelledby="sources-heading">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionHeaderIntro}>
              <h2 id="sources-heading" className={styles.sectionTitle}>
                {leafHeading(parsedPath)}
              </h2>
              <p className={styles.catalogTotal} aria-live="polite">
                {folderPage.totalCount.toLocaleString()}{" "}
                {folderPage.totalCount === 1 ? "source" : "sources"} in this folder
              </p>
              {parsedPath.kind === "message-transcripts" ? (
                <p className={styles.folderLeafDescription}>{CAB_FOLDER_DESCRIPTION}</p>
              ) : null}
            </div>
            <div className={styles.sectionToolbar}>
              <CatalogSortSelect sort={sort} order={order} />
              <PageSizeSelect value={limit} />
            </div>
          </div>

          {folderPage.items.length === 0 ? (
            <EmptyState />
          ) : (
            <SourcesTable items={folderPage.items} />
          )}

          <div className={styles.folderPageNav} aria-label="Folder pagination">
            <FolderPageNavLinks
              currentPage={folderPage.page}
              totalPages={totalPages}
              limit={limit}
              path={formatCatalogPath(parsedPath)}
              sort={sort}
              order={order}
            />
            <p className={styles.folderPageMeta}>
              {folderPage.totalCount > 0
                ? `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${folderPage.totalCount.toLocaleString()} · Page ${folderPage.page} of ${totalPages}`
                : "No entries on this page."}
            </p>
          </div>
        </main>
      </CatalogShell>
    );
  }

  redirect("/workspace/sources");
}

function CatalogShell({
  children,
  totalSources,
  showFlatToggle,
  flatActive,
}: {
  children: ReactNode;
  totalSources: number;
  showFlatToggle: boolean;
  flatActive: boolean;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Workspace</p>
          <h1 className={styles.title}>Source catalog</h1>
          <p className={styles.lead}>
            A curated library of Scripture and the Message, shared across the deployment.
            Open <strong>The Bible</strong> for scripture or <strong>The Message</strong>{" "}
            for sermons, or use a flat list to scan everything.
          </p>
        </div>
        <Link href="/workspace" className={styles.backLink}>
          Back to workspace
        </Link>
      </header>

      {showFlatToggle ? (
        <div className={styles.viewToggle}>
          {flatActive ? (
            <Link className={styles.viewToggleLink} href="/workspace/sources">
              Browse by folder
            </Link>
          ) : (
            <Link className={styles.viewToggleLink} href="/workspace/sources?flat=1">
              Flat table (all sources)
            </Link>
          )}
          <span className={styles.catalogTotal}>
            {totalSources.toLocaleString()}{" "}
            {totalSources === 1 ? "source" : "sources"} in the deployment
          </span>
        </div>
      ) : null}

      {children}
    </div>
  );
}

function FolderBrowseHeader({ parsedPath }: { parsedPath: ParsedCatalogPath }) {
  const trail = catalogPathBreadcrumbTrail(parsedPath);
  if (trail.length === 0) {
    return null;
  }
  return (
    <nav className={styles.breadcrumbs} aria-label="Folder path">
      <Link href="/workspace/sources">Catalog</Link>
      {trail.map((segment) => (
        <span key={segment.pathQuery}>
          <span className={styles.breadcrumbSep} aria-hidden="true">
            {" "}
            /{" "}
          </span>
          {segment.pathQuery === formatCatalogPath(parsedPath) ? (
            <span className={styles.breadcrumbCurrent}>{segment.label}</span>
          ) : (
            <Link href={folderHref(segment.pathQuery, {})}>{segment.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}

function leafHeading(path: ParsedCatalogPath): string {
  switch (path.kind) {
    case "bible-book":
      if (path.testament === "ot") {
        return `The Bible — Old Testament — ${path.bookLabel}`;
      }
      if (path.testament === "nt") {
        return `The Bible — New Testament — ${path.bookLabel}`;
      }
      return `The Bible — ${path.bookLabel}`;
    case "message-transcripts":
      return "The Message — CAB";
    case "message-year":
      return `The Message — ${path.year}`;
    case "other":
      return "Other sources";
    default:
      return "Sources";
  }
}

function FolderCard({
  href,
  title,
  count,
  subtitle,
}: {
  href: string;
  title: string;
  count: number;
  subtitle: string;
}) {
  return (
    <Link href={href} className={styles.folderCard} prefetch={false}>
      <span className={styles.folderCardTitle}>{title}</span>
      <span className={styles.folderCardMeta}>
        {count.toLocaleString()} {count === 1 ? "source" : "sources"}
      </span>
      <span className={styles.folderCardMeta}>{subtitle}</span>
    </Link>
  );
}

function folderHref(
  pathQuery: string,
  extras: { limit?: number },
): string {
  const search = new URLSearchParams();
  if (pathQuery.length > 0) {
    search.set("path", pathQuery);
  }
  if (extras.limit !== undefined) {
    search.set("limit", String(extras.limit));
  }
  const query = search.toString();
  return query.length > 0 ? `/workspace/sources?${query}` : "/workspace/sources";
}

function FolderPageNavLinks({
  currentPage,
  totalPages,
  limit,
  path,
  sort,
  order,
}: {
  currentPage: number;
  totalPages: number;
  limit: number;
  path: string;
  sort: string;
  order: string;
}) {
  const hasPrevious = currentPage > 1;
  const hasNext = currentPage < totalPages;

  const previousHref = hasPrevious
    ? offsetCatalogHref({
        path,
        limit,
        page: currentPage - 1,
        sort,
        order,
      })
    : null;
  const nextHref = hasNext
    ? offsetCatalogHref({
        path,
        limit,
        page: currentPage + 1,
        sort,
        order,
      })
    : null;

  return (
    <>
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
        <span
          className={`${styles.pageLink} ${styles.pageLinkDisabled}`}
          aria-hidden="true"
        >
          ← Previous page
        </span>
      )}
      {nextHref ? (
        <Link href={nextHref} className={styles.pageLink} prefetch={false} rel="next">
          Next page →
        </Link>
      ) : (
        <span
          className={`${styles.pageLink} ${styles.pageLinkDisabled}`}
          aria-hidden="true"
        >
          Next page →
        </span>
      )}
    </>
  );
}

function offsetCatalogHref(options: {
  path: string;
  limit: number;
  page: number;
  sort: string;
  order: string;
}): string {
  const params = new URLSearchParams();
  params.set("path", options.path);
  params.set("limit", String(options.limit));
  params.set("sort", options.sort);
  params.set("order", options.order);
  if (options.page > 1) {
    params.set("page", String(options.page));
  }
  return `/workspace/sources?${params.toString()}`;
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

function KeysetPagination({
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
        <span
          className={`${styles.pageLink} ${styles.pageLinkDisabled}`}
          aria-hidden="true"
        >
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
        <span
          className={`${styles.pageLink} ${styles.pageLinkDisabled}`}
          aria-hidden="true"
        >
          Next page →
        </span>
      )}
    </nav>
  );
}

function buildNextHref(
  limit: number,
  nextCursor: string,
  trail: string[],
  currentCursor: string | null,
): string {
  const nextTrail = currentCursor !== null ? [...trail, currentCursor] : trail;
  const params = new URLSearchParams({
    cursor: nextCursor,
    limit: String(limit),
    flat: "1",
  });
  if (nextTrail.length > 0) {
    params.set("trail", nextTrail.join(","));
  }
  return `/workspace/sources?${params.toString()}`;
}

function buildPreviousHref(limit: number, trail: string[]): string {
  const previousTrail = trail.slice(0, -1);
  const previousCursor = trail.length > 0 ? trail[trail.length - 1] : null;

  const params = new URLSearchParams({ limit: String(limit), flat: "1" });
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
