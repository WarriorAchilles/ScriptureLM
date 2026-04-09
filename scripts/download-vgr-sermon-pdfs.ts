/**
 * Bulk-download English sermon PDFs from branham.org (Voice of God Recordings).
 *
 * Listing discovery (same as the site’s year filters): POST JSON to
 * `https://branham.org/branham/messageaudio.aspx/wmSearchByYear` with
 * `{ formVars: [...serialized #frmcms fields..., { name: "year", value: "65-" }] }`.
 * The returned HTML fragment includes direct CloudFront PDF links per sermon (no per-sermon
 * messagestream fetch required for URLs).
 *
 * Saved files are named `{code}-{title-slug}.pdf` (e.g. `65-0117-a-paradox.pdf`), using the
 * listing title. A legacy `{code}.pdf` in the output folder still counts as already downloaded.
 *
 * Usage:
 *   npx tsx scripts/download-vgr-sermon-pdfs.ts --out ./data/branham-pdfs
 *   npx tsx scripts/download-vgr-sermon-pdfs.ts --out ./data/branham-pdfs --year 65
 *   npx tsx scripts/download-vgr-sermon-pdfs.ts ./data/branham-pdfs 47
 *   npm run download-vgr-pdfs -- ./data/branham-pdfs 47
 *
 * On some Windows/npm setups, `--out` / `--year` are not forwarded; use `--dest` or
 * positional `[outDir] [year]` after `--` as above.
 */

import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";

const MESSAGE_AUDIO_PAGE = "https://branham.org/en/MessageAudio";
const WM_SEARCH_BY_YEAR = "https://branham.org/branham/messageaudio.aspx/wmSearchByYear";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type FormVar = { name: string; value: string };

function getArg(name: string): string | undefined {
  const prefix = `${name}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name) {
      return process.argv[index + 1];
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

/**
 * Non-flag arguments after this script path. When npm/tsx drops `--out` / `--year`, only the
 * values remain (e.g. `./data/branham-pdfs` and `47`) and this recovers them.
 */
function positionalArgsAfterScript(): string[] {
  const scriptMarker = "download-vgr-sermon-pdfs.ts";
  const scriptIndex = process.argv.findIndex((argument) =>
    argument.replace(/\\/g, "/").endsWith(scriptMarker),
  );
  if (scriptIndex === -1) {
    return [];
  }
  return process.argv
    .slice(scriptIndex + 1)
    .filter((argument) => !argument.startsWith("-"));
}

function extractFormInnerHtml(html: string): string {
  const match = html.match(
    /<form[^>]*\bid="frmcms"[^>]*>([\s\S]*?)<\/form>/i,
  );
  if (!match) {
    throw new Error('Could not find <form id="frmcms"> on Message Audio page.');
  }
  return match[1];
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/**
 * Approximate jQuery serializeArray() for the Message Audio form (inputs + selects).
 */
function formVarsFromMessageAudioHtml(html: string): FormVar[] {
  const inner = extractFormInnerHtml(html);
  const vars: FormVar[] = [];

  const inputTagPattern = /<input\b([^>]*?)\/?>/gi;
  let inputMatch: RegExpExecArray | null;
  while ((inputMatch = inputTagPattern.exec(inner)) !== null) {
    const attrs = inputMatch[1];
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    if (!nameMatch) {
      continue;
    }
    const name = nameMatch[1];
    const typeMatch = attrs.match(/\btype="([^"]+)"/i);
    const inputType = (typeMatch?.[1] ?? "text").toLowerCase();
    if (
      inputType === "submit" ||
      inputType === "button" ||
      inputType === "image" ||
      inputType === "reset"
    ) {
      continue;
    }
    if (/\bdisabled\b/i.test(attrs)) {
      continue;
    }
    if (inputType === "checkbox" || inputType === "radio") {
      if (!/\bchecked\b/i.test(attrs)) {
        continue;
      }
    }
    const valueMatch = attrs.match(/\bvalue="([^"]*)"/i);
    const rawValue = valueMatch ? valueMatch[1] : "";
    vars.push({ name, value: decodeHtmlEntities(rawValue) });
  }

  const selectPattern = /<select\b([^>]*?)>([\s\S]*?)<\/select>/gi;
  let selectMatch: RegExpExecArray | null;
  while ((selectMatch = selectPattern.exec(inner)) !== null) {
    const openTag = selectMatch[1];
    const body = selectMatch[2];
    const nameMatch = openTag.match(/\bname="([^"]+)"/i);
    if (!nameMatch) {
      continue;
    }
    const name = nameMatch[1];
    let value = "";
    const selectedOption = body.match(
      /<option\b[^>]*\bselected\b[^>]*\bvalue="([^"]*)"/i,
    );
    if (selectedOption) {
      value = decodeHtmlEntities(selectedOption[1]);
    } else {
      const firstVal = body.match(/<option\b[^>]*\bvalue="([^"]*)"/i);
      if (firstVal) {
        value = decodeHtmlEntities(firstVal[1]);
      }
    }
    vars.push({ name, value });
  }

  const textareaPattern = /<textarea\b([^>]*?)>([\s\S]*?)<\/textarea>/gi;
  let textareaMatch: RegExpExecArray | null;
  while ((textareaMatch = textareaPattern.exec(inner)) !== null) {
    const openTag = textareaMatch[1];
    const body = textareaMatch[2];
    const nameMatch = openTag.match(/\bname="([^"]+)"/i);
    if (!nameMatch) {
      continue;
    }
    vars.push({ name: nameMatch[1], value: body });
  }

  return vars;
}

interface AjaxPayload {
  d: [string, string, string, string];
}

function parseYearPrefixes(filterYear?: string): string[] {
  const prefixes: string[] = [];
  for (let twoDigit = 47; twoDigit <= 65; twoDigit += 1) {
    const label = String(twoDigit);
    if (filterYear !== undefined && filterYear !== label) {
      continue;
    }
    prefixes.push(`${twoDigit}-`);
  }
  return prefixes;
}

/**
 * Title as shown in the listing (plain text inside prodtexttitle).
 */
function extractSermonTitleFromMessageChunk(chunk: string): string {
  const match = chunk.match(
    /<span class="prodtexttitle">([\s\S]*?)<\/span>/i,
  );
  if (!match) {
    return "";
  }
  const inner = match[1].replace(/<[^>]+>/g, "").trim();
  return decodeHtmlEntities(inner).trim();
}

const TITLE_SLUG_MAX_LEN = 120;

/**
 * Safe segment for Windows/macOS/Linux filenames: lowercase, hyphens, no reserved chars.
 */
function slugifyTitleForFilename(raw: string, maxLen: number): string {
  const stripped = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[''`’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!stripped) {
    return "";
  }
  if (stripped.length <= maxLen) {
    return stripped;
  }
  return stripped.slice(0, maxLen).replace(/-+$/, "");
}

/**
 * Extract sermon code, optional title, and PDF URL from wmSearchByYear HTML (search_results fragment).
 */
function extractPdfRowsFromSearchHtml(fragment: string): Array<{
  sermonCode: string;
  sermonTitle: string;
  pdfUrl: string;
}> {
  const results: Array<{
    sermonCode: string;
    sermonTitle: string;
    pdfUrl: string;
  }> = [];
  const boxes = fragment.split(/<div class="messagebox">/i);
  for (const chunk of boxes.slice(1)) {
    const streamMatch = chunk.match(/\/en\/messagestream\/ENG=([^"&\s]+)/i);
    const sermonCode = streamMatch?.[1]?.trim();
    if (!sermonCode) {
      continue;
    }
    const pdfMatch = chunk.match(
      /href="(https:\/\/d2w09gj4mqt5u\.cloudfront\.net\/repo\/[^"]+\.pdf)"/i,
    );
    if (!pdfMatch) {
      continue;
    }
    const sermonTitle = extractSermonTitleFromMessageChunk(chunk);
    results.push({ sermonCode, sermonTitle, pdfUrl: pdfMatch[1] });
  }
  return results;
}

/**
 * Base name without extension: `{code}-{title-slug}` or `{code}` if no slug.
 */
function pdfBaseNameForRow(
  sermonCode: string,
  sermonTitle: string,
  usedBasenames: Set<string>,
): string {
  const safeCode = sermonCode.replace(/[<>:"/\\|?*]/g, "_");
  const slug = slugifyTitleForFilename(sermonTitle, TITLE_SLUG_MAX_LEN);
  const base =
    slug.length > 0 ? `${safeCode}-${slug}` : safeCode;
  if (!usedBasenames.has(base)) {
    usedBasenames.add(base);
    return base;
  }
  let suffix = 2;
  while (usedBasenames.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  const unique = `${base}-${suffix}`;
  usedBasenames.add(unique);
  return unique;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  const maxAttempts = 4;
  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetch(url, init);
      if (response.status === 429 || response.status >= 500) {
        const waitMs = Math.min(8000, 400 * 2 ** attempt);
        console.warn(
          `${label}: HTTP ${response.status}, retry in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`,
        );
        await sleep(waitMs);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      const waitMs = Math.min(8000, 400 * 2 ** attempt);
      console.warn(
        `${label}: ${String(error)}, retry in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(waitMs);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

async function postSearchByYear(
  formBase: FormVar[],
  yearPrefix: string,
  cookieHeader: string,
): Promise<string> {
  const formVars: FormVar[] = [
    ...formBase.map((entry) => ({ ...entry })),
    { name: "year", value: yearPrefix },
  ];
  const body = JSON.stringify({ formVars });
  const response = await fetchWithRetry(
    WM_SEARCH_BY_YEAR,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "User-Agent": USER_AGENT,
        Origin: "https://branham.org",
        Referer: MESSAGE_AUDIO_PAGE,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body,
    },
    `wmSearchByYear ${yearPrefix}`,
  );
  if (!response.ok) {
    throw new Error(
      `wmSearchByYear ${yearPrefix}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const json = (await response.json()) as AjaxPayload;
  if (!json.d || !Array.isArray(json.d)) {
    throw new Error(`Unexpected AJAX response for ${yearPrefix}`);
  }
  return json.d[0] ?? "";
}

function collectSetCookieHeader(response: Response): string {
  const anyHeaders = response.headers as unknown as {
    getSetCookie?: () => string[];
  };
  if (typeof anyHeaders.getSetCookie === "function") {
    const parts = anyHeaders.getSetCookie();
    if (parts?.length) {
      return parts.map((cookieLine) => cookieLine.split(";")[0]).join("; ");
    }
  }
  const raw = (response.headers as unknown as { raw?: () => Record<string, string[]> })
    .raw?.()?.["set-cookie"];
  if (raw?.length) {
    return raw.map((cookieLine) => cookieLine.split(";")[0]).join("; ");
  }
  const single = response.headers.get("set-cookie");
  if (single) {
    return single.split(";")[0];
  }
  return "";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadPdfToFile(
  pdfUrl: string,
  destinationPath: string,
): Promise<void> {
  const response = await fetchWithRetry(
    pdfUrl,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/pdf,*/*",
      },
    },
    `GET ${pdfUrl.slice(0, 60)}…`,
  );
  if (!response.ok) {
    throw new Error(`PDF download failed: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("PDF response had no body");
  }
  await pipeline(response.body, createWriteStream(destinationPath));
}

async function main(): Promise<void> {
  const positionals = positionalArgsAfterScript();
  const outDir =
    getArg("--out") ??
    getArg("--dest") ??
    positionals[0];
  if (!outDir) {
    console.error(
      "Usage: tsx scripts/download-vgr-sermon-pdfs.ts --out <dir> [--year 47] [--dry-run]",
    );
    console.error(
      "       tsx scripts/download-vgr-sermon-pdfs.ts <dir> [year]   (if --out is stripped by npm/tsx)",
    );
    process.exit(1);
  }
  const yearFilter = getArg("--year") ?? positionals[1];
  const dryRun = hasFlag("--dry-run");
  const delayMs = Number.parseInt(getArg("--delay-ms") ?? "350", 10);

  const resolvedOut = resolve(process.cwd(), outDir);
  await mkdir(resolvedOut, { recursive: true });

  const pageResponse = await fetchWithRetry(
    MESSAGE_AUDIO_PAGE,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    },
    "GET MessageAudio",
  );
  if (!pageResponse.ok) {
    throw new Error(`Failed to load Message Audio: HTTP ${pageResponse.status}`);
  }
  let cookies = collectSetCookieHeader(pageResponse);
  const pageHtml = await pageResponse.text();
  let formBase = formVarsFromMessageAudioHtml(pageHtml);

  const prefixes = parseYearPrefixes(yearFilter);
  const seenCodes = new Set<string>();
  const rows: Array<{
    sermonCode: string;
    sermonTitle: string;
    pdfUrl: string;
  }> = [];

  for (const prefix of prefixes) {
    const fragment = await postSearchByYear(formBase, prefix, cookies);
    const extracted = extractPdfRowsFromSearchHtml(fragment);
    for (const row of extracted) {
      if (!seenCodes.has(row.sermonCode)) {
        seenCodes.add(row.sermonCode);
        rows.push(row);
      }
    }
    console.log(
      `Year ${prefix}: found ${extracted.length} PDF links (${seenCodes.size} unique total so far)`,
    );
    await sleep(delayMs);
    const refresh = await fetchWithRetry(
      MESSAGE_AUDIO_PAGE,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
      "GET MessageAudio (refresh)",
    );
    if (refresh.ok) {
      const nextCookies = collectSetCookieHeader(refresh);
      if (nextCookies) {
        cookies = nextCookies;
      }
      const nextHtml = await refresh.text();
      formBase = formVarsFromMessageAudioHtml(nextHtml);
    }
    await sleep(delayMs);
  }

  console.log(`\nTotal unique sermons with PDF URLs: ${rows.length}`);

  const usedBasenames = new Set<string>();
  const rowsWithNames = rows.map((row) => ({
    ...row,
    baseName: pdfBaseNameForRow(
      row.sermonCode,
      row.sermonTitle,
      usedBasenames,
    ),
  }));

  if (dryRun) {
    for (const { sermonCode, sermonTitle, pdfUrl, baseName } of rowsWithNames) {
      const titlePart = sermonTitle ? `  (${sermonTitle})` : "";
      console.log(`${baseName}.pdf  ${sermonCode}${titlePart}  ${pdfUrl}`);
    }
    return;
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const { sermonCode, pdfUrl, baseName } of rowsWithNames) {
    const dest = resolve(resolvedOut, `${baseName}.pdf`);
    const legacyDest = resolve(
      resolvedOut,
      `${sermonCode.replace(/[<>:"/\\|?*]/g, "_")}.pdf`,
    );
    if ((await fileExists(dest)) || (await fileExists(legacyDest))) {
      skipped += 1;
      await sleep(delayMs);
      continue;
    }
    try {
      await downloadPdfToFile(pdfUrl, dest);
      downloaded += 1;
      console.log(`Saved ${baseName}.pdf`);
    } catch (error) {
      failed += 1;
      console.error(`Failed ${sermonCode}:`, error);
    }
    await sleep(delayMs);
  }

  console.log(
    `\nDone. Downloaded: ${downloaded}, skipped (already present): ${skipped}, failed: ${failed}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
