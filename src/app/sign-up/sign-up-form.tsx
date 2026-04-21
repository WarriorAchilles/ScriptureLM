"use client";

import { useActionState } from "react";
import { registerAction, type RegisterState } from "@/app/actions/register";
import { AuthBrandHeader } from "@/components/auth-brand-header";
import styles from "@/app/auth.module.css";

const initialState: RegisterState = {};

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(
    registerAction,
    initialState,
  );

  return (
    <form className={styles.panel} action={formAction}>
      <AuthBrandHeader heading="Create account" />
      <p className={styles.subtitle}>
        Solo MVP: one workspace per user after you sign in.
      </p>
      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={styles.input}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={styles.input}
        />
      </div>
      <button type="submit" className={styles.submit} disabled={isPending}>
        {isPending ? "Creating…" : "Create account"}
      </button>
      <p className={styles.footer}>
        Already have an account? <a href="/sign-in">Sign in</a>
      </p>
    </form>
  );
}
