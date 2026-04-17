import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { listThreadMessages } from "@/lib/chat/thread";
import { ChatSurface } from "./chat-surface";
import styles from "./chat.module.css";

// Chat state mutates on every POST; the initial render needs the authenticated user
// and the freshest message list, so opt out of static caching entirely.
export const dynamic = "force-dynamic";

/**
 * Single-thread chat page for the signed-in user (Step 11; master spec §5.1 / §15 #4).
 *
 * Initial message history is fetched on the server so the first paint already shows
 * the conversation (no flash of empty state on reload). The client component takes
 * over for send/receive and keeps the list in sync via revalidation.
 */
export default async function ChatPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  const initial = await listThreadMessages(session.user.id);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Workspace</p>
          <h1 className={styles.title}>Chat</h1>
          <p className={styles.lead}>
            One conversation thread over the shared source catalog. Assistant
            replies arrive in a later step; for now your messages are persisted
            so you can reload without losing history.
          </p>
        </div>
        <Link href="/workspace" className={styles.backLink}>
          Back to workspace
        </Link>
      </header>

      <ChatSurface initialMessages={initial.messages} />
    </div>
  );
}
