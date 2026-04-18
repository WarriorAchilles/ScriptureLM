"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useTransition } from "react";
import styles from "./sources.module.css";

/**
 * Controlled select that rewrites the `limit` query param for the source catalog.
 *
 * Changing page size implicitly invalidates any existing keyset `cursor` (the row at
 * position N changes when N changes), so we strip it on navigation and send the user
 * back to the first page. We use `router.replace` instead of `push` because page size
 * is a view preference, not a distinct navigation step worth remembering in history.
 */

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export function PageSizeSelect({ value }: { value: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectId = useId();
  const [isPending, startTransition] = useTransition();

  const options = PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number])
    ? PAGE_SIZE_OPTIONS
    : ([...PAGE_SIZE_OPTIONS, value].sort((a, b) => a - b) as readonly number[]);

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextLimit = Number(event.target.value);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("limit", String(nextLimit));
    // Resizing the page invalidates every cursor in the breadcrumb trail (row N
    // is no longer the page boundary), so drop the trail and go back to page 1.
    params.delete("cursor");
    params.delete("trail");
    // Offset-based folder browse also resets to the first page.
    params.delete("page");
    startTransition(() => {
      router.replace(`/workspace/sources?${params.toString()}`);
    });
  }

  return (
    <div className={styles.pageSizeControl}>
      <label htmlFor={selectId} className={styles.pageSizeLabel}>
        Rows per page
      </label>
      <select
        id={selectId}
        className={styles.pageSizeSelect}
        value={value}
        onChange={handleChange}
        disabled={isPending}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
