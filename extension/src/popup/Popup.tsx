import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Highlight, LicenseState, Settings } from '@/types';
import { DEFAULT_SETTINGS, EMPTY_LICENSE_STATE } from '@/types';
import {
  deleteHighlight as deleteHighlightRecord,
  getAllHighlights,
  getHighlightsForPageIdentity,
  getSettings,
  getStats,
  updateSettings,
} from '@/storage/db';
import { normalizeUrl, pageIdFor, getDomain } from '@/utils/url';
import {
  HIGHLIGHT_WARNING_THRESHOLD,
  PURCHASE_URL,
  REGISTERED_HIGHLIGHT_LIMIT,
  UNREGISTERED_HIGHLIGHT_LIMIT,
} from '@/constants';
import { buildWordExport, downloadPdfExport, downloadTextFile } from './export';

type Stats = Awaited<ReturnType<typeof getStats>>;
type ViewMode = 'dashboard' | 'all';
type SortMode = 'newest' | 'oldest';

function openPurchasePage() {
  chrome.tabs.create({ url: PURCHASE_URL });
}

function startCodersNexusLogin(): Promise<LicenseState> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'START_EXTENSION_AUTH' }, (state: LicenseState | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || 'Could not open CodersNexus login.'));
        return;
      }
      if (!state) {
        reject(new Error('The extension background worker did not respond. Reload Nexus Highlighter from chrome://extensions, then try again.'));
        return;
      }
      resolve(state ?? EMPTY_LICENSE_STATE);
    });
  });
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

function getHighlightLimit(license: LicenseState) {
  if (license.hasAccess) return Number.POSITIVE_INFINITY;
  return license.key && license.userId ? REGISTERED_HIGHLIGHT_LIMIT : UNREGISTERED_HIGHLIGHT_LIMIT;
}

function getLimitLabel(limit: number) {
  return Number.isFinite(limit) ? limit.toLocaleString() : 'Unlimited';
}

function formatExpiryDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function Popup() {
  const [license, setLicense] = useState<LicenseState>(EMPTY_LICENSE_STATE);
  const [loadingLicense, setLoadingLicense] = useState(true);
  const [connectingAccount, setConnectingAccount] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showKeyBox, setShowKeyBox] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'REVERIFY_LICENSE' }, (state: LicenseState) => {
      setLicense(state ?? EMPTY_LICENSE_STATE);
      setLoadingLicense(false);
    });
  }, []);

  async function connectAccount() {
    if (connectingAccount) return;
    setConnectingAccount(true);
    setAuthError(null);

    try {
      const state = await startCodersNexusLogin();
      setLicense(state);
      setShowKeyBox(false);
      if (!state.key || !state.userId) {
        setAuthError(state.message || 'CodersNexus did not return a valid extension token.');
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not connect Nexus Highlighter.');
    } finally {
      setConnectingAccount(false);
    }
  }

  if (loadingLicense) {
    return (
      <div className="flex min-h-[420px] items-center justify-center bg-[#f6f3ee] font-body text-sm text-ink-soft">
        Loading Nexus Highlighter...
      </div>
    );
  }

  return (
    <Dashboard
      license={license}
      authError={authError}
      connectingAccount={connectingAccount}
      showKeyBox={showKeyBox || (!license.userId && license.status === 'invalid')}
      onConnect={connectAccount}
      onRequestKey={() => setShowKeyBox(true)}
      onPurchase={openPurchasePage}
      onLicenseChange={(state) => {
        setLicense(state);
        setShowKeyBox(false);
      }}
    />
  );
}

function Dashboard({
  license,
  authError,
  connectingAccount,
  showKeyBox,
  onConnect,
  onRequestKey,
  onPurchase,
  onLicenseChange,
}: {
  license: LicenseState;
  authError: string | null;
  connectingAccount: boolean;
  showKeyBox: boolean;
  onConnect: () => void;
  onRequestKey: () => void;
  onPurchase: () => void;
  onLicenseChange: (state: LicenseState) => void;
}) {
  const [view, setView] = useState<ViewMode>('dashboard');
  const [stats, setStats] = useState<Stats | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [currentPageCount, setCurrentPageCount] = useState<number | null>(null);
  const [currentDomain, setCurrentDomain] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const isRegistered = Boolean(license.key && license.userId);
  const limit = getHighlightLimit(license);
  const totalHighlights = stats?.totalHighlights ?? highlights.length;
  const usageRatio = Number.isFinite(limit) ? Math.min(1, totalHighlights / limit) : 0;
  const isNearLimit = Number.isFinite(limit) && usageRatio >= HIGHLIGHT_WARNING_THRESHOLD;
  const isAtLimit = Number.isFinite(limit) && totalHighlights >= limit;
  const recentHighlights = useMemo(
    () => [...highlights].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4),
    [highlights]
  );
  const domains = useMemo(() => [...new Set(highlights.map((h) => h.domain).filter(Boolean))].sort(), [highlights]);
  const filteredHighlights = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return highlights
      .filter((highlight) => {
        if (domainFilter !== 'all' && highlight.domain !== domainFilter) return false;
        if (!normalizedQuery) return true;
        return [highlight.anchor.selectedText, highlight.note ?? '', highlight.pageTitle, highlight.domain]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => (sortMode === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [domainFilter, highlights, query, sortMode]);

  async function loadDashboard() {
    const [nextStats, nextHighlights, nextSettings] = await Promise.all([getStats(), getAllHighlights(), getSettings()]);
    setStats(nextStats);
    setHighlights(nextHighlights);
    setSettings(nextSettings);

    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab?.url) return;
      try {
        const normalizedUrl = normalizeUrl(tab.url);
        const pageId = pageIdFor(normalizedUrl);
        const pageHighlights = await getHighlightsForPageIdentity(pageId, [normalizedUrl]);
        setCurrentPageCount(pageHighlights.length);
        setCurrentDomain(getDomain(tab.url));
      } catch {
        setCurrentPageCount(0);
      }
    });
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  function openSidebar() {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'OPEN_SIDEBAR' });
    });
  }

  async function exportAs(format: 'pdf' | 'doc') {
    const fresh = await new Promise<LicenseState>((resolve) =>
      chrome.runtime.sendMessage({ type: 'REVERIFY_LICENSE' }, resolve)
    );
    if (!fresh.hasAccess) {
      onLicenseChange(fresh);
      onPurchase();
      return;
    }

    const allHighlights = await getAllHighlights();
    if (format === 'pdf') {
      await downloadPdfExport(allHighlights, []);
    } else {
      downloadTextFile('nexus-highlighter-notes.doc', buildWordExport(allHighlights, []), 'application/msword');
    }
  }

  async function deleteHighlight(highlight: Highlight) {
    const deleted = await deleteHighlightRecord(highlight.id);
    if (deleted) {
      chrome.runtime.sendMessage({ type: 'SYNC_HIGHLIGHT', highlight: deleted }, () => void chrome.runtime.lastError);
    }
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHTS_UPDATED', pageId: highlight.pageId });
    });
    setStatusMessage('Highlight deleted.');
    await loadDashboard();
  }

  function clearAccount() {
    chrome.runtime.sendMessage({ type: 'CLEAR_LICENSE' }, () => onLicenseChange(EMPTY_LICENSE_STATE));
  }

  async function toggleCloudSync(enabled: boolean) {
    const nextSettings = await updateSettings({ syncToCloud: enabled, syncPreferenceSet: true });
    setSettings(nextSettings);
    if (enabled) {
      await syncNow();
    } else {
      setSyncMessage('Cloud sync is off.');
    }
  }

  async function syncNow() {
    if (syncingNow) return;
    if (!license.key || !license.userId) {
      setSyncMessage('Connect your account before syncing.');
      return;
    }

    setSyncingNow(true);
    setSyncMessage(null);
    chrome.runtime.sendMessage({ type: 'SYNC_ALL_HIGHLIGHTS', fullPull: true }, (response: { success?: boolean } | undefined) => {
      const error = chrome.runtime.lastError;
      setSyncingNow(false);
      if (error || !response?.success) {
        setSyncMessage('Sync failed. Try again in a moment.');
        return;
      }
      setSyncMessage('Synced to database.');
    });
  }

  return (
    <div className="min-h-[560px] bg-[#f6f3ee] font-body text-ink">
      <div className="border-b border-[#ded7ca] bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ExtensionIcon className="h-9 w-9 rounded-lg shadow-card" />
            <div>
              <h1 className="text-[15px] font-bold leading-tight text-ink">Nexus Highlighter</h1>
              <p className="text-[11px] font-medium text-ink-soft">Research notes, kept tidy</p>
            </div>
          </div>
          <PlanBadge license={license} onClick={onConnect} />
        </div>

        <div className="mt-3 grid grid-cols-2 rounded-lg bg-[#f0ece4] p-1 text-xs font-semibold">
          <button
            onClick={() => setView('dashboard')}
            className={`rounded-md px-3 py-2 transition ${view === 'dashboard' ? 'bg-white text-ink shadow-card' : 'text-ink-soft hover:text-ink'}`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setView('all')}
            className={`rounded-md px-3 py-2 transition ${view === 'all' ? 'bg-white text-ink shadow-card' : 'text-ink-soft hover:text-ink'}`}
          >
            All Highlights
          </button>
        </div>
      </div>

      <main className="max-h-[520px] overflow-y-auto px-4 py-4">
        {view === 'dashboard' ? (
          <DashboardView
            authError={authError}
            connectingAccount={connectingAccount}
            currentDomain={currentDomain}
            currentPageCount={currentPageCount}
            isAtLimit={isAtLimit}
            isNearLimit={isNearLimit}
            isRegistered={isRegistered}
            limit={limit}
            license={license}
            recentHighlights={recentHighlights}
            stats={stats}
            totalHighlights={totalHighlights}
            usageRatio={usageRatio}
            showKeyBox={showKeyBox}
            settings={settings}
            onConnect={onConnect}
            onOpenAll={() => setView('all')}
            onOpenSidebar={openSidebar}
            onPurchase={onPurchase}
            onRequestKey={onRequestKey}
            onLicenseChange={onLicenseChange}
            onDisconnect={clearAccount}
            onExport={exportAs}
            onToggleCloudSync={toggleCloudSync}
            onSyncNow={syncNow}
            syncingNow={syncingNow}
            syncMessage={syncMessage}
          />
        ) : (
          <AllHighlightsView
            domains={domains}
            domainFilter={domainFilter}
            highlights={filteredHighlights}
            query={query}
            sortMode={sortMode}
            statusMessage={statusMessage}
            totalCount={highlights.length}
            onDelete={deleteHighlight}
            onDomainFilter={setDomainFilter}
            onQuery={setQuery}
            onSort={setSortMode}
          />
        )}
      </main>
    </div>
  );
}

function DashboardView({
  authError,
  connectingAccount,
  currentDomain,
  currentPageCount,
  isAtLimit,
  isNearLimit,
  isRegistered,
  limit,
  license,
  recentHighlights,
  stats,
  totalHighlights,
  usageRatio,
  showKeyBox,
  settings,
  onConnect,
  onOpenAll,
  onOpenSidebar,
  onPurchase,
  onRequestKey,
  onLicenseChange,
  onDisconnect,
  onExport,
  onToggleCloudSync,
  onSyncNow,
  syncingNow,
  syncMessage,
}: {
  authError: string | null;
  connectingAccount: boolean;
  currentDomain: string;
  currentPageCount: number | null;
  isAtLimit: boolean;
  isNearLimit: boolean;
  isRegistered: boolean;
  limit: number;
  license: LicenseState;
  recentHighlights: Highlight[];
  stats: Stats | null;
  totalHighlights: number;
  usageRatio: number;
  showKeyBox: boolean;
  settings: Settings;
  onConnect: () => void;
  onOpenAll: () => void;
  onOpenSidebar: () => void;
  onPurchase: () => void;
  onRequestKey: () => void;
  onLicenseChange: (state: LicenseState) => void;
  onDisconnect: () => void;
  onExport: (format: 'pdf' | 'doc') => void;
  onToggleCloudSync: (enabled: boolean) => void;
  onSyncNow: () => void;
  syncingNow: boolean;
  syncMessage: string | null;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#ded7ca] bg-white p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase text-accent">Highlight Library</p>
            <p className="mt-1 text-2xl font-bold leading-none text-ink">{totalHighlights.toLocaleString()}</p>
            <p className="mt-1 text-xs text-ink-soft">saved highlights across {stats?.totalWebsites ?? 0} sources</p>
          </div>
          <div className="rounded-lg bg-[#eef0fa] px-3 py-2 text-right">
            <p className="text-[11px] font-semibold text-accent">This page</p>
            <p className="text-lg font-bold text-ink">{currentPageCount ?? 0}</p>
          </div>
        </div>

        <UsageMeter
          limit={limit}
          total={totalHighlights}
          usageRatio={usageRatio}
          isNearLimit={isNearLimit}
          isAtLimit={isAtLimit}
        />

        {!license.hasAccess && !isRegistered && (
          <LimitPrompt
            authError={authError}
            connectingAccount={connectingAccount}
            isAtLimit={isAtLimit}
            isNearLimit={isNearLimit}
            onConnect={onConnect}
          />
        )}

        {!license.hasAccess && isRegistered && isAtLimit && (
          <div className="mt-3 rounded-lg border border-[#f2c48d] bg-[#fff7ed] p-3 text-xs text-[#8a4b08]">
            You have reached {REGISTERED_HIGHLIGHT_LIMIT.toLocaleString()} free highlights. Upgrade when you are ready for a larger research library.
            <button onClick={onPurchase} className="mt-2 block font-bold text-[#7a3e00] underline">
              View upgrade options
            </button>
          </div>
        )}
      </section>

      <section className="grid grid-cols-3 gap-2">
        <Metric label="Notes" value={stats?.totalNotes ?? 0} tone="green" />
        <Metric label="This week" value={stats?.highlightsThisWeek ?? 0} tone="blue" />
        <Metric label="Sources" value={stats?.totalWebsites ?? 0} tone="rose" />
      </section>

      <section className="rounded-lg border border-[#ded7ca] bg-white p-3 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-ink">Quick actions</p>
            <p className="text-[11px] text-ink-soft">{currentDomain || 'Current tab tools'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton label="Open sidebar" icon={<PanelIcon />} onClick={onOpenSidebar} />
          <ActionButton label="All highlights" icon={<ListIcon />} onClick={onOpenAll} />
          <ActionButton label="Pricing plans" icon={<PriceTagIcon />} onClick={onPurchase} />
          <ActionButton label="Export PDF" icon={<DownloadIcon />} locked={!license.hasAccess} onClick={license.hasAccess ? () => onExport('pdf') : onPurchase} />
          <ActionButton label="Export Docs" icon={<DocumentIcon />} locked={!license.hasAccess} onClick={license.hasAccess ? () => onExport('doc') : onPurchase} />
        </div>
        {!license.hasAccess && (
          <p className="mt-2 text-[11px] text-ink-soft">Exports are available with a paid plan. Your free library stays fully manageable here.</p>
        )}
      </section>

      {recentHighlights.length ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-ink">Recent highlights</p>
            <button onClick={onOpenAll} className="text-xs font-bold text-accent hover:underline">
              Manage all
            </button>
          </div>
          {recentHighlights.map((highlight) => (
            <HighlightCard key={highlight.id} highlight={highlight} compact />
          ))}
        </section>
      ) : (
        <EmptyState onOpenSidebar={onOpenSidebar} />
      )}

      {showKeyBox ? (
        <LicenseBox license={license} onPurchase={onPurchase} onChange={onLicenseChange} />
      ) : license.key && license.userId ? (
        <AccountPanel
          license={license}
          settings={settings}
          onDisconnect={onDisconnect}
          onPurchase={onPurchase}
          onToggleCloudSync={onToggleCloudSync}
          onSyncNow={onSyncNow}
          syncingNow={syncingNow}
          syncMessage={syncMessage}
        />
      ) : (
        <button onClick={onRequestKey} className="w-full text-center text-xs font-bold text-accent underline">
          Have a license key? Enter it here
        </button>
      )}
    </div>
  );
}

function AllHighlightsView({
  domains,
  domainFilter,
  highlights,
  query,
  sortMode,
  statusMessage,
  totalCount,
  onDelete,
  onDomainFilter,
  onQuery,
  onSort,
}: {
  domains: string[];
  domainFilter: string;
  highlights: Highlight[];
  query: string;
  sortMode: SortMode;
  statusMessage: string | null;
  totalCount: number;
  onDelete: (highlight: Highlight) => void;
  onDomainFilter: (domain: string) => void;
  onQuery: (query: string) => void;
  onSort: (sort: SortMode) => void;
}) {
  return (
    <div className="space-y-3">
      <section>
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-base font-bold text-ink">All Highlights</h2>
            <p className="text-xs text-ink-soft">{highlights.length} visible from {totalCount} saved</p>
          </div>
          {statusMessage && <span className="rounded bg-[#e8f6ee] px-2 py-1 text-[11px] font-semibold text-[#267344]">{statusMessage}</span>}
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-[#ded7ca] bg-white p-3 shadow-card">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search text, notes, page, or website"
            className="h-10 w-full rounded-lg border border-[#ded7ca] bg-[#fbfaf7] pl-9 pr-3 text-sm outline-none transition focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/10"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={domainFilter}
            onChange={(event) => onDomainFilter(event.target.value)}
            className="h-9 rounded-lg border border-[#ded7ca] bg-[#fbfaf7] px-2 text-xs font-semibold outline-none focus:border-accent"
          >
            <option value="all">All websites</option>
            {domains.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
          <select
            value={sortMode}
            onChange={(event) => onSort(event.target.value as SortMode)}
            className="h-9 rounded-lg border border-[#ded7ca] bg-[#fbfaf7] px-2 text-xs font-semibold outline-none focus:border-accent"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </section>

      {highlights.length ? (
        <section className="space-y-2">
          {highlights.map((highlight) => (
            <HighlightCard key={highlight.id} highlight={highlight} onDelete={() => onDelete(highlight)} />
          ))}
        </section>
      ) : (
        <div className="rounded-lg border border-dashed border-[#cfc6b7] bg-white p-6 text-center shadow-card">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-[#eef0fa] text-accent">
            <SearchIcon className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-bold text-ink">No matching highlights</p>
          <p className="mt-1 text-xs leading-5 text-ink-soft">Try a different search, website filter, or sort order.</p>
        </div>
      )}
    </div>
  );
}

function HighlightCard({ highlight, compact = false, onDelete }: { highlight: Highlight; compact?: boolean; onDelete?: () => void }) {
  return (
    <article className="rounded-lg border border-[#ded7ca] bg-white p-3 shadow-card transition duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-toolbar">
      <p className={`${compact ? 'line-clamp-2' : ''} text-sm font-semibold leading-5 text-ink`}>
        {highlight.anchor.selectedText}
      </p>
      {highlight.note && <p className="mt-2 rounded-md bg-[#fff7d6] px-2 py-1.5 text-xs leading-5 text-[#594600]">{highlight.note}</p>}
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-ink-soft">
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{highlight.pageTitle || highlight.domain || 'Saved page'}</p>
          <p className="truncate">{highlight.domain} - {formatDate(highlight.createdAt)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <IconButton label="Open original page" onClick={() => chrome.tabs.create({ url: highlight.url })}>
            <OpenIcon />
          </IconButton>
          {onDelete && (
            <IconButton label="Delete highlight" danger onClick={onDelete}>
              <TrashIcon />
            </IconButton>
          )}
        </div>
      </div>
    </article>
  );
}

function UsageMeter({
  limit,
  total,
  usageRatio,
  isNearLimit,
  isAtLimit,
}: {
  limit: number;
  total: number;
  usageRatio: number;
  isNearLimit: boolean;
  isAtLimit: boolean;
}) {
  if (!Number.isFinite(limit)) {
    return (
      <div className="mt-4 rounded-lg border border-[#d5eadc] bg-[#f0fbf4] px-3 py-2">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-bold text-[#267344]">Unlimited highlights available</span>
          <span className="font-bold text-ink">{total.toLocaleString()} saved</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-bold text-ink">Usage</span>
        <span className={`font-bold ${isAtLimit ? 'text-[#b42318]' : isNearLimit ? 'text-[#9a5b00]' : 'text-ink-soft'}`}>
          {total.toLocaleString()} / {getLimitLabel(limit)} highlights
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#e6ded1]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isAtLimit ? 'bg-[#d92d20]' : isNearLimit ? 'bg-[#f79009]' : 'bg-accent'}`}
          style={{ width: `${Number.isFinite(limit) ? usageRatio * 100 : 100}%` }}
        />
      </div>
    </div>
  );
}

function LimitPrompt({
  authError,
  connectingAccount,
  isAtLimit,
  isNearLimit,
  onConnect,
}: {
  authError: string | null;
  connectingAccount: boolean;
  isAtLimit: boolean;
  isNearLimit: boolean;
  onConnect: () => void;
}) {
  if (!isAtLimit && !isNearLimit) {
    return (
      <div className="mt-3 rounded-lg bg-[#eef0fa] p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold leading-5 text-ink">
            Register free to raise your limit from {UNREGISTERED_HIGHLIGHT_LIMIT.toLocaleString()} to {REGISTERED_HIGHLIGHT_LIMIT.toLocaleString()} highlights.
          </p>
          <button onClick={onConnect} disabled={connectingAccount} className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white transition hover:bg-[#263d86] disabled:opacity-60">
            {connectingAccount ? 'Opening...' : `Unlock ${REGISTERED_HIGHLIGHT_LIMIT.toLocaleString()} Free`}
          </button>
        </div>
        {authError && <p className="mt-2 text-xs font-semibold text-[#b42318]">{authError}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-[#f2c48d] bg-[#fff7ed] p-3">
      <p className="text-xs font-semibold leading-5 text-[#8a4b08]">
        {isAtLimit
          ? `You have reached ${UNREGISTERED_HIGHLIGHT_LIMIT.toLocaleString()} highlights. Register free to continue saving up to ${REGISTERED_HIGHLIGHT_LIMIT.toLocaleString()}.`
          : `You are close to ${UNREGISTERED_HIGHLIGHT_LIMIT.toLocaleString()} highlights. Register free before you hit the limit.`}
      </p>
      <button onClick={onConnect} disabled={connectingAccount} className="mt-2 w-full rounded-lg bg-[#f79009] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#d97904] disabled:opacity-60">
        {connectingAccount ? 'Opening secure login...' : `Increase Limit to ${REGISTERED_HIGHLIGHT_LIMIT.toLocaleString()} - Free`}
      </button>
      {authError && <p className="mt-2 text-xs font-semibold text-[#b42318]">{authError}</p>}
    </div>
  );
}

function EmptyState({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <section className="rounded-lg border border-dashed border-[#cfc6b7] bg-white p-6 text-center shadow-card">
      <ExtensionIcon className="mx-auto h-12 w-12 rounded-lg shadow-card" />
      <h2 className="mt-3 text-base font-bold text-ink">Build your research library</h2>
      <p className="mt-1 text-xs leading-5 text-ink-soft">Select text on any page, save it as a highlight, then manage everything from here.</p>
      <button onClick={onOpenSidebar} className="mt-4 rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white transition hover:bg-black">
        Open sidebar
      </button>
    </section>
  );
}

function LicenseBox({
  license,
  onPurchase,
  onChange,
}: {
  license: LicenseState;
  onPurchase: () => void;
  onChange: (state: LicenseState) => void;
}) {
  const [key, setKey] = useState(license.key ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(license.status === 'invalid' ? license.message : null);

  function submit() {
    if (!key.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    chrome.runtime.sendMessage({ type: 'VERIFY_LICENSE', key: key.trim() }, (state: LicenseState) => {
      setSubmitting(false);
      if (state?.userId) {
        onChange(state);
      } else {
        setError(state?.message ?? 'Could not verify this license key.');
      }
    });
  }

  return (
    <section className="rounded-lg border border-[#ded7ca] bg-white p-3 shadow-card">
      <label className="mb-1 block text-xs font-bold text-ink">License key</label>
      <input
        value={key}
        onChange={(event) => setKey(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && submit()}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        className="h-10 w-full rounded-lg border border-[#ded7ca] bg-[#fbfaf7] px-3 text-sm outline-none transition focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/10"
        autoFocus
      />
      {error && <p className="mt-2 text-xs font-semibold text-[#b42318]">{error}</p>}
      <button
        onClick={submit}
        disabled={submitting || !key.trim()}
        className="mt-2 w-full rounded-lg bg-accent py-2 text-xs font-bold text-white transition hover:bg-[#263d86] disabled:opacity-50"
      >
        {submitting ? 'Verifying...' : 'Activate key'}
      </button>
      <button className="mt-2 w-full text-center text-xs font-bold text-accent underline" onClick={onPurchase}>
        Buy or upgrade a plan
      </button>
    </section>
  );
}

function AccountPanel({
  license,
  settings,
  onDisconnect,
  onPurchase,
  onToggleCloudSync,
  onSyncNow,
  syncingNow,
  syncMessage,
}: {
  license: LicenseState;
  settings: Settings;
  onDisconnect: () => void;
  onPurchase: () => void;
  onToggleCloudSync: (enabled: boolean) => void;
  onSyncNow: () => void;
  syncingNow: boolean;
  syncMessage: string | null;
}) {
  const expiresOn = formatExpiryDate(license.expiresAt);

  return (
    <section className="rounded-lg border border-[#ded7ca] bg-white p-3 text-xs shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{license.userFullName || 'Registered account'}</p>
          <p className="text-ink-soft">{license.planName || 'Starter'} plan</p>
          <p className="mt-0.5 text-[11px] font-semibold text-ink-soft">
            {expiresOn ? `Expires on ${expiresOn}` : 'No expiry date available'}
          </p>
        </div>
        <button onClick={onDisconnect} className="rounded-md px-2 py-1 font-bold text-ink-soft transition hover:bg-[#f0ece4] hover:text-ink">
          Disconnect
        </button>
      </div>
      <button onClick={onPurchase} className="mt-2 w-full rounded-lg border border-[#ded7ca] bg-[#fbfaf7] px-3 py-2 font-bold text-ink transition hover:border-accent/40 hover:bg-white hover:text-accent">
        Pricing plans
      </button>
      <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#ded7ca] bg-[#fbfaf7] px-3 py-2">
        <span>
          <span className="block font-bold text-ink">Cloud sync</span>
          <span className="block text-[11px] leading-4 text-ink-soft">Save highlights to your CodersNexus account.</span>
        </span>
        <input
          type="checkbox"
          checked={settings.syncToCloud}
          onChange={(event) => onToggleCloudSync(event.target.checked)}
          className="h-4 w-4 accent-[#3450a3]"
        />
      </label>
      <button
        onClick={onSyncNow}
        disabled={!settings.syncToCloud || syncingNow}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 font-bold text-white transition hover:bg-[#263d86] disabled:cursor-not-allowed disabled:bg-[#b8becf] disabled:text-white/80"
      >
        <SyncIcon className={syncingNow ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        {syncingNow ? 'Syncing...' : 'Sync now'}
      </button>
      {!settings.syncToCloud && (
        <p className="mt-1 text-[11px] font-semibold text-ink-soft">Enable Cloud sync to save highlights to the database.</p>
      )}
      {syncMessage && <p className="mt-1 text-[11px] font-semibold text-ink-soft">{syncMessage}</p>}
      {!license.hasAccess && (
        <button onClick={onPurchase} className="mt-2 w-full rounded-lg bg-ink px-3 py-2 font-bold text-white transition hover:bg-black">
          Upgrade for exports
        </button>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'green' | 'blue' | 'rose' }) {
  const tones = {
    green: 'bg-[#e8f6ee] text-[#267344]',
    blue: 'bg-[#eef0fa] text-accent',
    rose: 'bg-[#fff0f3] text-[#b4234b]',
  };
  return (
    <div className={`rounded-lg p-3 text-center shadow-card ${tones[tone]}`}>
      <p className="text-lg font-bold leading-none">{value.toLocaleString()}</p>
      <p className="mt-1 text-[10px] font-bold uppercase">{label}</p>
    </div>
  );
}

function PlanBadge({ license, onClick }: { license: LicenseState; onClick: () => void }) {
  if (license.hasAccess) {
    return <span className="rounded-full bg-[#e8f6ee] px-3 py-1 text-[11px] font-bold text-[#267344]">Pro</span>;
  }
  if (license.key && license.userId) {
    return <span className="rounded-full bg-[#eef0fa] px-3 py-1 text-[11px] font-bold text-accent">Free {REGISTERED_HIGHLIGHT_LIMIT.toLocaleString()}</span>;
  }
  return (
    <button onClick={onClick} className="rounded-full bg-[#fff3bf] px-3 py-1 text-[11px] font-bold text-[#594600] transition hover:bg-[#ffe889]">
      Free {UNREGISTERED_HIGHLIGHT_LIMIT.toLocaleString()}
    </button>
  );
}

function ActionButton({
  icon,
  label,
  locked = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-disabled={locked}
      title={locked ? 'Premium feature - opens pricing' : label}
      className={`group relative flex h-10 items-center justify-center gap-2 rounded-lg border px-2 text-xs font-bold transition ${
        locked
          ? 'border-[#ded7ca] bg-[#f0ece4] text-ink-soft hover:-translate-y-0.5 hover:border-[#f79009] hover:bg-[#fff7ed] hover:text-[#8a4b08] focus:border-[#f79009] focus:outline-none focus:ring-4 focus:ring-[#f79009]/15'
          : 'border-[#ded7ca] bg-[#fbfaf7] text-ink hover:-translate-y-0.5 hover:border-accent/40 hover:bg-white hover:text-accent'
      }`}
    >
      {icon}
      {label}
      {locked && (
        <span className="pointer-events-none absolute -top-8 left-1/2 z-10 w-max -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-[11px] font-bold text-white opacity-0 shadow-toolbar transition group-hover:opacity-100 group-focus:opacity-100">
          Premium feature
        </span>
      )}
    </button>
  );
}

function IconButton({
  children,
  danger = false,
  label,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md border transition hover:-translate-y-0.5 ${
        danger
          ? 'border-[#ffd7d3] bg-[#fff1f0] text-[#b42318] hover:bg-[#ffe4e0]'
          : 'border-[#ded7ca] bg-[#fbfaf7] text-ink-soft hover:border-accent/40 hover:text-accent'
      }`}
    >
      {children}
    </button>
  );
}

function ExtensionIcon({ className }: { className: string }) {
  return <img src={chrome.runtime.getURL('public/icons/icon48.png')} alt="" className={className} />;
}

function SearchIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 4h6v6" />
      <path d="M10 14 20 4" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 5h16v14H4z" />
      <path d="M9 5v14" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v6h5" />
      <path d="M10 13h6" />
      <path d="M10 17h6" />
    </svg>
  );
}

function PriceTagIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 10 12 2H5a3 3 0 0 0-3 3v7l8 8a3 3 0 0 0 4.2 0l5.8-5.8a3 3 0 0 0 0-4.2Z" />
      <path d="M7.5 7.5h.01" />
    </svg>
  );
}

function SyncIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 0 1-15.5 6.2" />
      <path d="M3 12A9 9 0 0 1 18.5 5.8" />
      <path d="M18 2v4h4" />
      <path d="M6 22v-4H2" />
    </svg>
  );
}
