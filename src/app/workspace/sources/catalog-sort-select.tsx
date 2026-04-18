"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useTransition } from "react";
import type { CatalogSortField, CatalogSortOrder } from "@/lib/sources/catalog-folders";
import styles from "./sources.module.css";

type SortSelectProps = {
  sort: CatalogSortField;
  order: CatalogSortOrder;
};

/**
 * Rewrites `sort` / `order` query params for folder leaf views. Resets `page` to 1.
 */
export function CatalogSortSelect({ sort, order }: SortSelectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectId = useId();
  const [isPending, startTransition] = useTransition();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    const [nextSort, nextOrder] = value.split(":") as [
      CatalogSortField,
      CatalogSortOrder,
    ];
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("sort", nextSort);
    params.set("order", nextOrder);
    params.delete("page");
    startTransition(() => {
      router.replace(`/workspace/sources?${params.toString()}`);
    });
  }

  const currentValue = `${sort}:${order}`;

  return (
    <div className={styles.sortControl}>
      <label htmlFor={selectId} className={styles.sortLabel}>
        Sort
      </label>
      <select
        id={selectId}
        className={styles.sortSelect}
        value={currentValue}
        onChange={handleChange}
        disabled={isPending}
      >
        <option value="updated:desc">Updated (newest)</option>
        <option value="updated:asc">Updated (oldest)</option>
        <option value="title:asc">Title (A–Z)</option>
        <option value="title:desc">Title (Z–A)</option>
        <option value="status:asc">Status (A–Z)</option>
        <option value="status:desc">Status (Z–A)</option>
      </select>
    </div>
  );
}
