import type { Highlight, PageRecord } from '@/types';

export function buildMarkdownExport(highlights: Highlight[], pages: PageRecord[]): string {
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const byPage = new Map<string, Highlight[]>();
  highlights.forEach((h) => {
    const list = byPage.get(h.pageId) ?? [];
    list.push(h);
    byPage.set(h.pageId, list);
  });

  const sections = [...byPage.entries()].map(([pageId, hs]) => {
    const page = pageById.get(pageId);
    const title = page?.title ?? hs[0]?.pageTitle ?? 'Untitled page';
    const url = page?.url ?? hs[0]?.url ?? '';
    const body = hs
      .map((h) => {
        const tagLine = h.tags.length ? `\nTags: ${h.tags.map((t) => `#${t}`).join(' ')}` : '';
        const noteBlock = h.note ? `\n\n### Note\n\n${h.note}` : '';
        return `## Highlight\n\n> ${h.anchor.selectedText}${noteBlock}${tagLine}`;
      })
      .join('\n\n---\n\n');
    return `# ${title}\n\nSource: ${url}\n\n${body}`;
  });

  return sections.join('\n\n===\n\n');
}

export function buildJsonExport(highlights: Highlight[], pages: PageRecord[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), pages, highlights }, null, 2);
}

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  // chrome.downloads with a data: URL, rather than a blob: URL, so the
  // download survives even if the popup closes right after the click.
  const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
}
