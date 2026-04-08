import styles from "@/app/auth.module.css";
import { SignUpForm } from "./sign-up-form";

export default function SignUpPage() {
  return (
    <div className={styles.page}>
      <SignUpForm />
    </div>
  );
}
