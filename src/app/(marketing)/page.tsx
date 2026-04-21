import Image from "next/image";
import authStyles from "@/app/auth.module.css";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={authStyles.page}>
      <ThemeToggle />
      <main className={styles.main}>
        <header className={styles.hero}>
          <div className={styles.logoWrap}>
            <Image
              src="/scripturelm-logo-fire-subtle.png"
              alt=""
              width={400}
              height={245}
              priority
              className={styles.logo}
            />
          </div>
          <h1 className={styles.wordmark}>ScriptureLM</h1>
          <p className={styles.tagline}>Theological research workspace</p>
        </header>
        <p className={styles.description}>
          Shared catalog, RAG chat, and grounded summaries — a calm place to
          study with sources you trust. This scaffold ships first; richer tools
          follow in later steps.
        </p>
        <div className={styles.ctaRow}>
          <a className={styles.ctaPrimary} href="/sign-in">
            Sign in
          </a>
          <a className={styles.ctaSecondary} href="/sign-up">
            Create account
          </a>
        </div>
        <p className={styles.footerLinks}>
          Returning? <a href="/workspace">Open workspace</a>
        </p>
      </main>
    </div>
  );
}
