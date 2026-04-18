import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { listThreadMessages } from "@/lib/chat/thread";
import { listCatalogSources } from "@/lib/sources/list-catalog";
import { ChatSurface } from "./chat-surface";
import styles from "./chat.module.css";

// Chat state mutates on every POST; the initial render needs the authenticated user
// and the freshest message list, so opt out of static caching entirely.
export const dynamic = "force-dynamic";

// Catalog ceiling for the scope picker's multi-select. Master spec §4 sizes
// the catalog at ~1,200 rows; MAX_LIMIT (200) is plenty for a first page, and
// Step 14 #2 explicitly permits client-side filtering at this scale.
const SCOPE_CATALOG_LIMIT = 200;

/**
 * Single-thread chat page for the signed-in user (Step 11; master spec §5.1 / §15 #4).
 *
 * Initial message history is fetched on the server so the first paint already shows
 * the conversation (no flash of empty state on reload). The client component takes
 * over for send/receive and keeps the list in sync via revalidation.
 *
 * Step 14 also preloads the READY source catalog so the scope picker can render
 * its multi-select immediately without an extra client fetch on mount.
 */
export default async function ChatPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  const [initial, catalog] = await Promise.all([
    listThreadMessages(session.user.id),
    listCatalogSources({ limit: SCOPE_CATALOG_LIMIT }),
  ]);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Workspace</p>
          <h1 className={styles.title}>Chat</h1>
          <p className={styles.lead}>
            One conversation thread over the shared source catalog. Replies are
            grounded in retrieved passages from Scripture and the sermon
            transcripts, with inline citation labels (`[C1]`, `[C2]`, …) you
            can match back to the source.
          </p>
        </div>
        <Link href="/workspace" className={styles.backLink}>
          Back to workspace
        </Link>
      </header>

      <ChatSurface
        initialMessages={initial.messages}
        catalog={catalog.items}
      />
    </div>
  );
}
