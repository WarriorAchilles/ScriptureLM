import Image from "next/image";
import styles from "@/app/auth.module.css";

type AuthBrandHeaderProps = {
  heading: string;
};

/** Logo lockup + page heading for sign-in / sign-up. */
export function AuthBrandHeader({ heading }: AuthBrandHeaderProps) {
  return (
    <div className={styles.brand}>
      <div className={styles.logoWrap}>
        <Image
          src="/scripturelm-logo-fire-subtle.png"
          alt=""
          width={360}
          height={220}
          priority
          className={styles.logo}
        />
      </div>
      <p className={styles.wordmark}>ScriptureLM</p>
      <h1 className={styles.title}>{heading}</h1>
    </div>
  );
}
