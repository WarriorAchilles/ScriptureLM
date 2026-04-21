import { auth } from "@/auth";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/sign-out";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "@/app/workspace/workspace.module.css";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.brandRow}>
          <Image
            src="/scripturelm-logo-fire-subtle.png"
            alt=""
            width={120}
            height={74}
            className={styles.brandLogo}
            priority
          />
          <span className={styles.brand}>ScriptureLM</span>
        </Link>
        <div className={styles.headerActions}>
          <ThemeToggle variant="inline" />
          <form action={signOutAction}>
            <button type="submit" className={styles.signOut}>
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.content}>
          <h1 className={styles.title}>Workspace</h1>
          <p className={styles.lead}>
            Signed in as {session.user.email ?? session.user.id}. Choose where
            to go next.
          </p>
          <nav className={styles.actions} aria-label="Workspace areas">
            <Link href="/workspace/chat" className={styles.actionPrimary}>
              Open chat
            </Link>
            <Link href="/workspace/sources" className={styles.actionSecondary}>
              Source catalog
            </Link>
            <Link href="/workspace/summaries" className={styles.actionSecondary}>
              Summaries
            </Link>
          </nav>
        </div>
      </main>
    </div>
  );
}
