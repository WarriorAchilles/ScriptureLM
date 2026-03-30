import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>ScriptureLM</h1>
        <p className={styles.subtitle}>
          Theological research workspace — shared catalog, RAG chat, and grounded
          summaries. This is the Step 01 scaffold; features arrive in later steps.
        </p>
      </main>
    </div>
  );
}
