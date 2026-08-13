import type { Highlight, PageRecord } from '@/types';

function groupHighlightsByPage(highlights: Highlight[]) {
  const byPage = new Map<string, Highlight[]>();
  highlights.forEach((h) => {
    const list = byPage.get(h.pageId) ?? [];
    list.push(h);
    byPage.set(h.pageId, list);
  });
  return byPage;
}

export function buildWordExport(highlights: Highlight[], pages: PageRecord[]): string {
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const byPage = groupHighlightsByPage(highlights);
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const sections = [...byPage.entries()]
    .map(([pageId, hs]) => {
      const page = pageById.get(pageId);
      const title = page?.title ?? hs[0]?.pageTitle ?? 'Untitled page';
      const url = page?.url ?? hs[0]?.url ?? '';
      const highlightsHtml = hs
        .map((h, index) => {
          const note = h.note ? `<p><strong>Note:</strong> ${escapeHtml(h.note)}</p>` : '';
          const tags = h.tags.length ? `<p><strong>Tags:</strong> ${escapeHtml(h.tags.join(', '))}</p>` : '';
          return `<article><h3>Highlight ${index + 1}</h3><blockquote>${escapeHtml(
            h.anchor.selectedText
          )}</blockquote>${note}${tags}</article>`;
        })
        .join('');

      return `<section><h2>${escapeHtml(title)}</h2><p class="source">Source: ${escapeHtml(
        url
      )}</p>${highlightsHtml}</section>`;
    })
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>NoteMark Study Notes</title>
  <style>
    body { font-family: Aptos, Calibri, Arial, sans-serif; color: #1f2933; line-height: 1.5; }
    h1 { font-size: 24pt; margin-bottom: 4pt; }
    h2 { font-size: 16pt; margin-top: 22pt; border-bottom: 1px solid #d7dce2; padding-bottom: 4pt; }
    h3 { font-size: 12pt; margin-top: 14pt; }
    blockquote { margin: 6pt 0; padding: 8pt 10pt; background: #fff6bf; border-left: 4pt solid #f2c94c; }
    .source, .meta { color: #64748b; font-size: 10pt; }
  </style>
</head>
<body>
  <h1>NoteMark Study Notes</h1>
  <p class="meta">Exported ${escapeHtml(new Date().toLocaleString())} - ${highlights.length} highlights</p>
  ${sections || '<p>No highlights to export.</p>'}
</body>
</html>`;
}

export async function downloadPdfExport(highlights: Highlight[], pages: PageRecord[]) {
  const { jsPDF } = await import('jspdf');
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const byPage = groupHighlightsByPage(highlights);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const textWidth = pageWidth - margin * 2;
  let y = margin;

  function ensureSpace(height = 48) {
    if (y + height <= pageHeight - margin) return;
    doc.addPage();
    y = margin;
  }

  function writeText(text: string, size = 10, style: 'normal' | 'bold' = 'normal', gap = 12) {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text || ' ', textWidth) as string[];
    ensureSpace(lines.length * (size + 4) + gap);
    doc.text(lines, margin, y);
    y += lines.length * (size + 4) + gap;
  }

  writeText('NoteMark Study Notes', 22, 'bold', 8);
  writeText(`Exported ${new Date().toLocaleString()} - ${highlights.length} highlights`, 9, 'normal', 24);

  if (highlights.length === 0) {
    writeText('No highlights to export.', 11);
  }

  [...byPage.entries()].forEach(([pageId, hs]) => {
    const page = pageById.get(pageId);
    const title = page?.title ?? hs[0]?.pageTitle ?? 'Untitled page';
    const url = page?.url ?? hs[0]?.url ?? '';

    ensureSpace(90);
    writeText(title, 15, 'bold', 6);
    writeText(`Source: ${url}`, 8, 'normal', 12);

    hs.forEach((h, index) => {
      ensureSpace(84);
      writeText(`Highlight ${index + 1}`, 11, 'bold', 4);
      writeText(h.anchor.selectedText, 10, 'normal', 8);
      if (h.note) writeText(`Note: ${h.note}`, 10, 'normal', 8);
      if (h.tags.length) writeText(`Tags: ${h.tags.join(', ')}`, 9, 'normal', 14);
    });
  });

  doc.save('notemark-study-notes.pdf');
}

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  // chrome.downloads with a data: URL, rather than a blob: URL, so the
  // download survives even if the popup closes right after the click.
  const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
}
