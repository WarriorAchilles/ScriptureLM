import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/sign-out";
import styles from "@/app/workspace/workspace.module.css";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>ScriptureLM</span>
        <form action={signOutAction}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </header>
      <main className={styles.main}>
        <h1 className={styles.title}>Workspace</h1>
        <p className={styles.lead}>
          Signed in as {session.user.email ?? session.user.id}. Sources and chat
          will appear in later steps — this is your empty shell.
        </p>
      </main>
    </div>
  );
}
