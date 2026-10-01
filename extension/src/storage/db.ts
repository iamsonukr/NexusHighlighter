import type { Highlight, LicenseState, PageRecord, Settings } from '@/types';
import { DEFAULT_SETTINGS, EMPTY_LICENSE_STATE } from '@/types';
import { normalizeUrl } from '@/utils/url';

/**
 * Local persistence layer.
 *
 * Local storage remains the source of truth, and the background sync client
 * mirrors highlight changes to the backend once a Pro license exists.
 * This wrapper keeps src/content and src/popup ignorant of where data is
 * ultimately mirrored.
 *
 * chrome.storage.local (not localStorage) is used deliberately: it's
 * available to the background worker and content scripts alike, isn't wiped
 * with site data, and has a much larger quota. IndexedDB is the natural next
 * step if a single user's highlight count grows large enough that reading/
 * writing the whole bucket on every mutation becomes a bottleneck (see
 * README "Known limitations").
 */

const KEYS = {
  highlights: 'nm_highlights', // legacy Record<id, Highlight>
  highlightPrefix: 'nm_hl:',
  pages: 'nm_pages', // Record<id, PageRecord>
  settings: 'nm_settings',
  license: 'nm_license',
} as const;

async function getBucket<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T) ?? fallback;
}

async function setBucket<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// ---------- Highlights ----------

async function migrateLegacyHighlights(): Promise<void> {
  const legacyMap = await getBucket<Record<string, Highlight>>(KEYS.highlights, {});
  const entries = Object.entries(legacyMap);
  if (!entries.length) return;

  const next: Record<string, Highlight> = {};
  entries.forEach(([id, highlight]) => {
    next[`${KEYS.highlightPrefix}${id}`] = highlight;
  });
  next[KEYS.highlights] = {};
  await chrome.storage.local.set(next);
}

async function getHighlightMapIncludingDeleted(): Promise<Record<string, Highlight>> {
  await migrateLegacyHighlights();
  const result = await chrome.storage.local.get(null);
  const highlights: Record<string, Highlight> = {};
  Object.entries(result).forEach(([key, value]) => {
    if (!key.startsWith(KEYS.highlightPrefix)) return;
    const highlight = value as Highlight;
    if (highlight?.id) highlights[highlight.id] = highlight;
  });
  return highlights;
}

export async function getAllHighlights(): Promise<Highlight[]> {
  const map = await getHighlightMapIncludingDeleted();
  return Object.values(map).filter((h) => !h.deletedAt);
}

export async function getAllHighlightRecords(): Promise<Highlight[]> {
  const map = await getHighlightMapIncludingDeleted();
  return Object.values(map);
}

export async function getHighlightRecordMap(): Promise<Record<string, Highlight>> {
  return getHighlightMapIncludingDeleted();
}

export async function getHighlightsForPage(pageId: string): Promise<Highlight[]> {
  const all = await getAllHighlights();
  return all.filter((h) => h.pageId === pageId);
}

export async function getHighlightsForPageIdentity(pageId: string, urlCandidates: string[]): Promise<Highlight[]> {
  const all = await getAllHighlights();
  const urls = new Set(urlCandidates.map(safeNormalizeUrl).filter(Boolean));
  return all.filter((h) => {
    if (h.pageId === pageId) return true;
    return urls.has(safeNormalizeUrl(h.canonicalUrl)) || urls.has(safeNormalizeUrl(h.url));
  });
}

export async function getHighlightsForDomain(domain: string): Promise<Highlight[]> {
  const all = await getAllHighlights();
  return all.filter((h) => h.domain === domain);
}

export async function upsertHighlight(highlight: Highlight): Promise<void> {
  await chrome.storage.local.set({ [`${KEYS.highlightPrefix}${highlight.id}`]: highlight });
}

export async function deleteHighlight(id: string): Promise<Highlight | undefined> {
  await migrateLegacyHighlights();
  const key = `${KEYS.highlightPrefix}${id}`;
  const result = await chrome.storage.local.get(key);
  const highlight = result[key] as Highlight | undefined;
  if (highlight) {
    // soft delete: keeps the record around so sync can propagate
    // the deletion instead of the row just silently reappearing.
    const deleted = { ...highlight, deletedAt: Date.now(), updatedAt: Date.now() };
    await chrome.storage.local.set({ [key]: deleted });
    return deleted;
  }
  return undefined;
}

export async function pruneDeletedHighlights(olderThanMs = 30 * 24 * 60 * 60 * 1000): Promise<void> {
  const map = await getHighlightMapIncludingDeleted();
  const cutoff = Date.now() - olderThanMs;
  const keysToRemove = Object.values(map)
    .filter((highlight) => highlight.deletedAt && highlight.deletedAt < cutoff)
    .map((highlight) => `${KEYS.highlightPrefix}${highlight.id}`);

  if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);
}

/** Duplicate guard: same page + same exact text + not deleted. */
export async function findDuplicateHighlight(
  pageId: string,
  selectedText: string
): Promise<Highlight | undefined> {
  const pageHighlights = await getHighlightsForPage(pageId);
  return pageHighlights.find(
    (h) => h.anchor.selectedText.trim() === selectedText.trim()
  );
}

// ---------- Pages ----------

export async function getPage(pageId: string): Promise<PageRecord | undefined> {
  const map = await getBucket<Record<string, PageRecord>>(KEYS.pages, {});
  return map[pageId];
}

export async function getAllPages(): Promise<PageRecord[]> {
  const map = await getBucket<Record<string, PageRecord>>(KEYS.pages, {});
  return Object.values(map);
}

export async function upsertPage(page: PageRecord): Promise<void> {
  const map = await getBucket<Record<string, PageRecord>>(KEYS.pages, {});
  map[page.id] = page;
  await setBucket(KEYS.pages, map);
}

// ---------- Settings ----------

export async function getSettings(): Promise<Settings> {
  const stored = await getBucket<Partial<Settings>>(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await setBucket(KEYS.settings, next);
  return next;
}

// ---------- License ----------
// No user accounts are stored — just the single verification result for
// the one license key the person entered in the popup.

export async function getLicenseState(): Promise<LicenseState> {
  return getBucket<LicenseState>(KEYS.license, EMPTY_LICENSE_STATE);
}

export async function saveLicenseState(state: LicenseState): Promise<void> {
  await setBucket(KEYS.license, state);
}

export async function clearLicenseState(): Promise<void> {
  await setBucket(KEYS.license, EMPTY_LICENSE_STATE);
}

// ---------- Stats (dashboard/popup) ----------

export async function getStats() {
  const [highlights, pages] = await Promise.all([getAllHighlights(), getAllPages()]);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const domainCounts = new Map<string, number>();
  highlights.forEach((h) => domainCounts.set(h.domain, (domainCounts.get(h.domain) ?? 0) + 1));
  const mostHighlighted = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    totalHighlights: highlights.length,
    totalNotes: highlights.filter((h) => !!h.note).length,
    totalWebsites: new Set(highlights.map((h) => h.domain)).size,
    totalPages: pages.length,
    highlightsThisWeek: highlights.filter((h) => h.createdAt >= weekAgo).length,
    mostHighlightedDomain: mostHighlighted?.[0] ?? null,
  };
}

/** Simple client-side search across highlighted text, notes, tags, and page title. */
export async function searchHighlights(query: string): Promise<Highlight[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await getAllHighlights();
  return all.filter((h) =>
    [h.anchor.selectedText, h.note ?? '', h.pageTitle, h.domain, ...h.tags]
      .join(' ')
      .toLowerCase()
      .includes(q)
  );
}

function safeNormalizeUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return normalizeUrl(url);
  } catch {
    return url;
  }
}
