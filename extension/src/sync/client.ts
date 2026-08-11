import type { Highlight } from '@/types';
import {
  getAllHighlightRecords,
  getHighlightRecordMap,
  getLicenseState,
  upsertHighlight as saveHighlight,
  upsertPage,
} from '@/storage/db';
import { getDomain } from '@/utils/url';

const SYNC_API_BASE_URL = (import.meta.env.VITE_NOTEMARK_SYNC_API_URL || 'http://localhost:5000/api').replace(
  /\/+$/,
  ''
);
const LAST_PULL_KEY = 'nm_sync_last_highlight_pull';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  conflict?: boolean;
}

interface RemoteHighlight {
  clientId: string;
  pageId: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  pageTitle: string;
  anchor: Highlight['anchor'];
  color: Highlight['color'];
  note: string | null;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  clientCreatedAt: number;
  clientUpdatedAt: number;
  deletedAt: number | null;
}

function toRemoteHighlight(highlight: Highlight): RemoteHighlight {
  return {
    clientId: highlight.id,
    pageId: highlight.pageId,
    url: highlight.url,
    canonicalUrl: highlight.canonicalUrl,
    domain: highlight.domain,
    pageTitle: highlight.pageTitle,
    anchor: highlight.anchor,
    color: highlight.color,
    note: highlight.note,
    tags: highlight.tags,
    isPinned: highlight.isPinned,
    isArchived: highlight.isArchived,
    clientCreatedAt: highlight.createdAt,
    clientUpdatedAt: highlight.updatedAt,
    deletedAt: highlight.deletedAt,
  };
}

function fromRemoteHighlight(remote: RemoteHighlight): Highlight {
  return {
    id: remote.clientId,
    userId: 'local',
    pageId: remote.pageId,
    url: remote.url,
    canonicalUrl: remote.canonicalUrl,
    domain: remote.domain,
    pageTitle: remote.pageTitle,
    anchor: remote.anchor,
    color: remote.color,
    note: remote.note,
    tags: remote.tags,
    isPinned: remote.isPinned,
    isArchived: remote.isArchived,
    isSynced: true,
    createdAt: remote.clientCreatedAt,
    updatedAt: remote.clientUpdatedAt,
    deletedAt: remote.deletedAt,
  };
}

async function getLicenseKey(): Promise<string | null> {
  const state = await getLicenseState();
  return state.hasAccess && state.key ? state.key : null;
}

async function readLastPull(): Promise<number> {
  const result = await chrome.storage.local.get(LAST_PULL_KEY);
  return Number(result[LAST_PULL_KEY] ?? 0);
}

async function writeLastPull(value: number): Promise<void> {
  await chrome.storage.local.set({ [LAST_PULL_KEY]: value });
}

async function readJson<T>(res: Response): Promise<ApiResponse<T>> {
  const data = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!res.ok || !data?.success) {
    throw new Error(data?.message ?? `Sync request failed with ${res.status}`);
  }
  return data;
}

async function saveRemoteHighlight(remote: RemoteHighlight): Promise<string> {
  const highlight = fromRemoteHighlight(remote);
  await saveHighlight(highlight);
  await upsertPage({
    id: highlight.pageId,
    url: highlight.url,
    canonicalUrl: highlight.canonicalUrl,
    domain: highlight.domain || getDomain(highlight.url),
    title: highlight.pageTitle || 'Untitled page',
    description: null,
    favicon: null,
    readingStatus: 'reading',
    lastVisitedAt: highlight.updatedAt,
    createdAt: highlight.createdAt,
    updatedAt: highlight.updatedAt,
  });
  return highlight.pageId;
}

export async function syncHighlight(highlight: Highlight): Promise<Set<string>> {
  const licenseKey = await getLicenseKey();
  const changedPageIds = new Set<string>();
  if (!licenseKey) return changedPageIds;

  const res = await fetch(`${SYNC_API_BASE_URL}/highlights`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-license-key': licenseKey,
    },
    body: JSON.stringify(toRemoteHighlight(highlight)),
  });
  const payload = await readJson<RemoteHighlight>(res);
  if (payload.data) {
    changedPageIds.add(await saveRemoteHighlight(payload.data));
    await writeLastPull(Math.max(await readLastPull(), payload.data.clientUpdatedAt));
  }
  return changedPageIds;
}

export async function pullRemoteHighlights(): Promise<Set<string>> {
  const licenseKey = await getLicenseKey();
  const changedPageIds = new Set<string>();
  if (!licenseKey) return changedPageIds;

  const since = await readLastPull();
  const res = await fetch(`${SYNC_API_BASE_URL}/highlights?since=${encodeURIComponent(String(since))}`, {
    headers: { 'x-license-key': licenseKey },
  });
  const payload = await readJson<RemoteHighlight[]>(res);
  const remotes = payload.data ?? [];
  const localMap = await getHighlightRecordMap();
  let nextLastPull = since;

  for (const remote of remotes) {
    nextLastPull = Math.max(nextLastPull, remote.clientUpdatedAt);
    const local = localMap[remote.clientId];
    if (local && local.updatedAt > remote.clientUpdatedAt) continue;
    changedPageIds.add(await saveRemoteHighlight(remote));
  }

  if (nextLastPull > since) await writeLastPull(nextLastPull);
  return changedPageIds;
}

export async function syncAllHighlights(): Promise<Set<string>> {
  const changedPageIds = new Set<string>();
  const records = await getAllHighlightRecords();

  for (const record of records) {
    try {
      const pageIds = await syncHighlight(record);
      pageIds.forEach((pageId) => changedPageIds.add(pageId));
    } catch {
      // Keep syncing the rest; a later popup open or write will retry.
    }
  }

  const pulledPageIds = await pullRemoteHighlights();
  pulledPageIds.forEach((pageId) => changedPageIds.add(pageId));
  return changedPageIds;
}
