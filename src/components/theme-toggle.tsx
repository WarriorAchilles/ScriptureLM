"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import styles from "./theme-toggle.module.css";

type ThemeToggleProps = {
  /** Fixed top-right (default) or inline next to other header actions */
  variant?: "fixed" | "inline";
};

export function ThemeToggle({ variant = "fixed" }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function cycle() {
    if (theme === "light") {
      setTheme("dark");
      return;
    }
    if (theme === "dark") {
      setTheme("system");
      return;
    }
    setTheme("light");
  }

  const label = !mounted
    ? "Theme"
    : theme === "system"
      ? resolvedTheme === "dark"
        ? "Auto (dark)"
        : "Auto (light)"
      : theme === "dark"
        ? "Dark"
        : "Light";

  return (
    <div
      className={
        variant === "fixed" ? styles.wrapFixed : styles.wrapInline
      }
    >
      <button
        type="button"
        className={styles.toggle}
        onClick={cycle}
        aria-label={`Theme: ${label}. Click to cycle light, dark, and system.`}
      >
        {label}
      </button>
    </div>
  );
}
