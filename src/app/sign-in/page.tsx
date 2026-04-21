import { Suspense } from "react";
import styles from "@/app/auth.module.css";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignInForm } from "./sign-in-form";

function RegisteredBanner({ show }: { show: boolean }) {
  if (!show) {
    return null;
  }
  return (
    <div className={styles.banner} role="status">
      Account created. You can sign in now.
    </div>
  );
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string }>;
}) {
  const params = await searchParams;
  const showRegistered = params.registered === "1";

  return (
    <div className={styles.page}>
      <ThemeToggle />
      <RegisteredBanner show={showRegistered} />
      <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
