/**
 * Text extraction for ingest (Step 07).
 *
 * **PDF:** Uses Mozilla pdf.js (`pdfjs-dist` legacy build) to read the **text layer only**
 * (embedded fonts / positioning). **No OCR** — scanned PDFs without a text layer will yield
 * empty or useless text; operators must use text-native PDFs per master spec §15 #8.
 *
 * **Markdown / plain text:** Interpreted as **UTF-8** (invalid sequences may be replaced by
 * Node when decoding — callers may validate upstream).
 */

import type { Readable } from "node:stream";
import type { SourceType } from "@prisma/client";

async function bufferFromInput(input: Buffer | Readable): Promise<Buffer> {
  if (Buffer.isBuffer(input)) {
    return input;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function extractPdfTextLayer(bytes: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(bytes);
  const loadingTask = pdfjs.getDocument({ data });
  const pdfDocument = await loadingTask.promise;
  try {
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const lineParts: string[] = [];
      for (const item of textContent.items) {
        if (typeof item === "object" && item !== null && "str" in item) {
          const str = (item as { str: string }).str;
          if (str) {
            lineParts.push(str);
          }
        }
      }
      pageTexts.push(lineParts.join(" "));
    }
    return pageTexts.join("\n\n");
  } finally {
    await pdfDocument.cleanup();
  }
}

/**
 * Extracts plain text from a source blob. PDF path is async (text layer only; no OCR).
 */
export async function extractText(
  sourceType: SourceType,
  input: Buffer | Readable,
): Promise<string> {
  const buffer = await bufferFromInput(input);
  if (sourceType === "pdf") {
    return extractPdfTextLayer(buffer);
  }
  return buffer.toString("utf8");
}
