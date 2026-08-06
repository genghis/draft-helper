/**
 * Extracts the text items of a PDF, in reading order, one string per item.
 *
 * pdf.js is imported dynamically so its ~1 MB of engine and worker never
 * touches the initial bundle — it loads only when someone actually picks a
 * PDF, which most users never will.
 */
export async function readPdfText(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  // Vite resolves this to a hashed asset URL and bundles the worker separately;
  // without it pdf.js falls back to fetching a CDN worker, which the site's CSP
  // and offline-at-the-draft-table both rule out.
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import("pdfjs-dist/build/pdf.worker.mjs?url")
  ).default;

  // Keep the loading task: destroy() lives there, not on the document proxy,
  // and it is what tears down the worker.
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  const lines: string[] = [];
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      for (const item of content.items) {
        const text = (item as { str?: string }).str?.trim();
        if (text) lines.push(text);
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return lines;
}
