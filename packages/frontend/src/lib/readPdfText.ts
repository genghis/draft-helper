/**
 * Extracts the text items of a PDF, in reading order, one string per item.
 *
 * pdf.js is imported dynamically so its ~1 MB of engine and worker never
 * touches the initial bundle — it loads only when someone actually picks a
 * PDF, which most users never will.
 */
/** ESPN's rankings are a single page; these bound a mis-picked document. */
const MAX_PAGES = 25;
const MAX_TEXT_ITEMS = 20_000;

export async function readPdfText(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  // Vite resolves this to a hashed asset URL and bundles the worker separately.
  // Without it pdf.js fetches its worker from a CDN, which would break at a
  // draft table on bad wifi and adds a third party to a page that needs none.
  // Same-origin also means pdf.js uses a plain module Worker rather than a
  // blob wrapper, so a future CSP of `worker-src 'self'` would just work.
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import("pdfjs-dist/build/pdf.worker.mjs?url")
  ).default;

  // Keep the loading task: destroy() lives there, not on the document proxy,
  // and it is what tears down the worker.
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  const lines: string[] = [];
  try {
    // A 5 MB cap bounds bytes, not work: text compresses hard, so that is
    // thousands of pages. ESPN's rankings are one page; anything past these
    // caps is the wrong document, and stopping beats hanging the tab.
    const maxPages = Math.min(doc.numPages, MAX_PAGES);
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      for (const item of content.items) {
        const text = (item as { str?: string }).str?.trim();
        if (text) lines.push(text);
      }
      page.cleanup();
      if (lines.length > MAX_TEXT_ITEMS) break;
    }
  } finally {
    await task.destroy();
  }
  return lines;
}
