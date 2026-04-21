import styles from "@/app/auth.module.css";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignUpForm } from "./sign-up-form";

export default function SignUpPage() {
  return (
    <div className={styles.page}>
      <ThemeToggle />
      <SignUpForm />
    </div>
  );
}
