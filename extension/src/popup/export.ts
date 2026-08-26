import type { Highlight, PageRecord } from '@/types';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

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
  <title>Nexus Highlighter Study Notes</title>
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
  <h1>Nexus Highlighter Study Notes</h1>
  <p class="meta">Exported ${escapeHtml(new Date().toLocaleString())} - ${highlights.length} highlights</p>
  ${sections || '<p>No highlights to export.</p>'}
</body>
</html>`;
}

export async function downloadPdfExport(highlights: Highlight[], pages: PageRecord[]) {
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const byPage = groupHighlightsByPage(highlights);
  const doc = await PDFDocument.create();
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const textWidth = pageWidth - margin * 2;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function ensureSpace(height = 48) {
    if (y - height >= margin) return;
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  }

  function safePdfText(text: string, font: PDFFont, size: number) {
    return [...(text || ' ')].map((char) => {
      try {
        font.widthOfTextAtSize(char, size);
        return char;
      } catch {
        return '?';
      }
    }).join('');
  }

  function wrapText(text: string, font: PDFFont, size: number) {
    const normalized = safePdfText(text, font, size);
    const lines: string[] = [];

    normalized.split(/\r?\n/).forEach((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push(' ');
        return;
      }

      let line = '';
      words.forEach((word) => {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= textWidth) {
          line = candidate;
          return;
        }

        if (line) lines.push(line);
        if (font.widthOfTextAtSize(word, size) <= textWidth) {
          line = word;
          return;
        }

        let chunk = '';
        [...word].forEach((char) => {
          const nextChunk = `${chunk}${char}`;
          if (font.widthOfTextAtSize(nextChunk, size) <= textWidth) {
            chunk = nextChunk;
          } else {
            if (chunk) lines.push(chunk);
            chunk = char;
          }
        });
        line = chunk;
      });

      if (line) lines.push(line);
    });

    return lines.length ? lines : [' '];
  }

  function drawHighlightBackground(targetPage: PDFPage, topY: number, lineCount: number, lineHeight: number) {
    targetPage.drawRectangle({
      x: margin - 6,
      y: topY - lineCount * lineHeight + 3,
      width: textWidth + 12,
      height: lineCount * lineHeight + 6,
      color: rgb(1, 0.96, 0.75),
    });
  }

  function writeText(text: string, size = 10, style: 'normal' | 'bold' = 'normal', gap = 12, highlight = false) {
    const font = style === 'bold' ? boldFont : regularFont;
    const lineHeight = size + 4;
    const lines = wrapText(text, font, size);
    ensureSpace(lines.length * lineHeight + gap);
    if (highlight) drawHighlightBackground(page, y, lines.length, lineHeight);
    lines.forEach((line) => {
      page.drawText(line, { x: margin, y, size, font, color: rgb(0.12, 0.16, 0.2) });
      y -= lineHeight;
    });
    y -= gap;
  }

  writeText('Nexus Highlighter Study Notes', 22, 'bold', 8);
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
      writeText(h.anchor.selectedText, 10, 'normal', 8, true);
      if (h.note) writeText(`Note: ${h.note}`, 10, 'normal', 8);
      if (h.tags.length) writeText(`Tags: ${h.tags.join(', ')}`, 9, 'normal', 14);
    });
  });

  const bytes = await doc.save();
  downloadBinaryFile('nexus-highlighter-study-notes.pdf', bytes, 'application/pdf');
}

function downloadBinaryFile(filename: string, bytes: Uint8Array, mimeType: string) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  chrome.downloads.download({
    url: `data:${mimeType};base64,${btoa(binary)}`,
    filename,
    saveAs: true,
  });
}

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  // chrome.downloads with a data: URL, rather than a blob: URL, so the
  // download survives even if the popup closes right after the click.
  const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
}
