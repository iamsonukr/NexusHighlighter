import { useEffect, useState } from 'react';
import type { Highlight, LicenseState } from '@/types';
import { EMPTY_LICENSE_STATE } from '@/types';
import { getStats, getHighlightsForPage, getAllHighlights, getAllPages, searchHighlights } from '@/storage/db';
import { normalizeUrl, pageIdFor, getDomain } from '@/utils/url';
import { FREE_HIGHLIGHT_LIMIT, HIGHLIGHT_WARNING_THRESHOLD } from '@/constants';
import { buildMarkdownExport, buildJsonExport, downloadTextFile } from './export';

type Stats = Awaited<ReturnType<typeof getStats>>;

export function Popup() {
  const [license, setLicense] = useState<LicenseState>(EMPTY_LICENSE_STATE);
  const [loadingLicense, setLoadingLicense] = useState(true);
  const [showKeyBox, setShowKeyBox] = useState(false);

  useEffect(() => {
    // Live network re-check on every popup open — not a cached read. This is
    // what actually closes the "hand-edit chrome.storage to fake Pro" hole:
    // a tampered local hasAccess flag gets overwritten by the real server
    // answer the next time the popup is opened, not just at browser start.
    chrome.runtime.sendMessage({ type: 'REVERIFY_LICENSE' }, (state: LicenseState) => {
      setLicense(state ?? EMPTY_LICENSE_STATE);
      setLoadingLicense(false);
    });
  }, []);

  if (loadingLicense) {
    return <div className="bg-paper p-6 text-sm text-ink-soft">Loading…</div>;
  }

  return (
    <Dashboard
      license={license}
      showKeyBox={showKeyBox || (!license.hasAccess && license.status === 'invalid')}
      onRequestUpgrade={() => setShowKeyBox(true)}
      onLicenseChange={(state) => {
        setLicense(state);
        setShowKeyBox(false);
      }}
    />
  );
}

// ---------------------------------------------------------------------------

function Dashboard({
  license,
  showKeyBox,
  onRequestUpgrade,
  onLicenseChange,
}: {
  license: LicenseState;
  showKeyBox: boolean;
  onRequestUpgrade: () => void;
  onLicenseChange: (state: LicenseState) => void;
}) {
  const isPro = license.hasAccess;
  const [stats, setStats] = useState<Stats | null>(null);
  const [currentPageCount, setCurrentPageCount] = useState<number | null>(null);
  const [currentDomain, setCurrentDomain] = useState<string>('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Highlight[] | null>(null);

  useEffect(() => {
    getStats().then(setStats);
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab?.url) return;
      try {
        const pageId = pageIdFor(normalizeUrl(tab.url));
        const highlights = await getHighlightsForPage(pageId);
        setCurrentPageCount(highlights.length);
        setCurrentDomain(getDomain(tab.url));
      } catch {
        setCurrentPageCount(0);
      }
    });
  }, []);

  async function runSearch(q: string) {
    setQuery(q);
    if (!isPro) {
      setResults(null); // free tier: per-page search lives in the sidebar instead
      return;
    }
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setResults(await searchHighlights(q));
  }

  async function exportAs(format: 'md' | 'json') {
    // Re-check live rather than trusting the license prop from when the
    // popup opened — belt-and-braces for the one Pro action that actually
    // writes a file to disk.
    const fresh = await new Promise<LicenseState>((resolve) =>
      chrome.runtime.sendMessage({ type: 'REVERIFY_LICENSE' }, resolve)
    );
    if (!fresh.hasAccess) {
      onLicenseChange(fresh);
      onRequestUpgrade();
      return;
    }
    const [highlights, pages] = await Promise.all([getAllHighlights(), getAllPages()]);
    if (format === 'md') {
      downloadTextFile('notemark-export.md', buildMarkdownExport(highlights, pages), 'text/markdown');
    } else {
      downloadTextFile('notemark-export.json', buildJsonExport(highlights, pages), 'application/json');
    }
  }

  function openSidebar() {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'OPEN_SIDEBAR' });
    });
  }

  const usageRatio = stats ? Math.min(1, stats.totalHighlights / FREE_HIGHLIGHT_LIMIT) : 0;
  const nearLimit = !isPro && usageRatio >= HIGHLIGHT_WARNING_THRESHOLD;

  return (
    <div className="bg-paper p-4 font-body text-ink">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-marker-yellow text-sm">✎</div>
          <h1 className="font-display text-lg leading-none">NoteMark</h1>
        </div>
        <PlanBadge license={license} onClick={onRequestUpgrade} />
      </div>

      <div className="mb-3">
        <input
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          placeholder={isPro ? 'Search all your highlights…' : 'Search this page in the sidebar →'}
          disabled={!isPro}
          className="w-full rounded border border-rule bg-white px-3 py-1.5 text-sm outline-none focus:border-accent disabled:cursor-not-allowed disabled:bg-rule/30 disabled:text-ink-soft"
        />
        {!isPro && (
          <p className="mt-1 text-[11px] text-ink-soft">
            Searching across every saved page is a{' '}
            <button className="font-medium text-accent underline" onClick={onRequestUpgrade}>
              Pro
            </button>{' '}
            feature.
          </p>
        )}
      </div>

      {results && (
        <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto rounded border border-rule bg-white p-2">
          {results.length === 0 && <li className="p-1 text-xs text-ink-soft">No matches.</li>}
          {results.map((h) => (
            <li key={h.id}>
              <button
                className="block w-full truncate rounded px-1.5 py-1 text-left text-xs hover:bg-accent-soft"
                title={h.anchor.selectedText}
                onClick={() => chrome.tabs.create({ url: h.url })}
              >
                “{h.anchor.selectedText.slice(0, 60)}” <span className="text-ink-soft">· {h.domain}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <StatBox label="Highlights" value={stats?.totalHighlights} />
        <StatBox label="Notes" value={stats?.totalNotes} />
        <StatBox label="Sites" value={stats?.totalWebsites} />
      </div>

      {!isPro && stats && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[11px] text-ink-soft">
            <span>Free plan usage</span>
            <span>
              {stats.totalHighlights}/{FREE_HIGHLIGHT_LIMIT}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-rule">
            <div
              className={`h-full rounded-full ${nearLimit ? 'bg-marker-orange' : 'bg-accent'}`}
              style={{ width: `${usageRatio * 100}%` }}
            />
          </div>
          {nearLimit && (
            <p className="mt-1 text-[11px] text-marker-orange">
              Almost at your free limit —{' '}
              <button className="underline" onClick={onRequestUpgrade}>
                go unlimited
              </button>
              .
            </p>
          )}
        </div>
      )}

      <div className="mb-3 rounded-lg border border-rule bg-white p-3 shadow-card">
        <p className="text-xs font-medium text-ink-soft">Current page{currentDomain ? ` · ${currentDomain}` : ''}</p>
        <p className="mt-1 font-display text-xl">
          {currentPageCount ?? '–'} <span className="text-sm font-body text-ink-soft">highlights</span>
        </p>
      </div>

      <button
        onClick={openSidebar}
        className="mb-2 w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent/90"
      >
        Open sidebar on this page
      </button>

      <div className="mb-3 flex gap-2">
        <ExportButton label="Export .md" disabled={!isPro} onClick={() => exportAs('md')} />
        <ExportButton label="Export .json" disabled={!isPro} onClick={() => exportAs('json')} />
      </div>
      {!isPro && (
        <p className="-mt-2 mb-3 text-[11px] text-ink-soft">
          Export is a{' '}
          <button className="font-medium text-accent underline" onClick={onRequestUpgrade}>
            Pro
          </button>{' '}
          feature.
        </p>
      )}

      {showKeyBox ? (
        <LicenseBox license={license} onChange={onLicenseChange} />
      ) : isPro ? (
        <p className="text-center text-[11px] text-ink-soft">
          {license.userFullName ? `Licensed to ${license.userFullName}` : 'Pro'}
          {license.planName ? ` · ${license.planName}` : ''}
          {' · '}
          <button
            className="underline"
            onClick={() =>
              chrome.runtime.sendMessage({ type: 'CLEAR_LICENSE' }, () => onLicenseChange(EMPTY_LICENSE_STATE))
            }
          >
            Change key
          </button>
        </p>
      ) : (
        <button onClick={onRequestUpgrade} className="w-full text-center text-xs font-medium text-accent underline">
          Have a license key? Enter it here
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlanBadge({ license, onClick }: { license: LicenseState; onClick: () => void }) {
  if (license.hasAccess) {
    return (
      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
        {license.planName ?? 'Pro'}
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      className="rounded-full bg-marker-yellow px-2 py-0.5 text-[11px] font-medium text-ink hover:brightness-95"
    >
      Free · Upgrade
    </button>
  );
}

function LicenseBox({ license, onChange }: { license: LicenseState; onChange: (state: LicenseState) => void }) {
  const [key, setKey] = useState(license.key ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(license.status === 'invalid' ? license.message : null);

  function submit() {
    if (!key.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    chrome.runtime.sendMessage({ type: 'VERIFY_LICENSE', key: key.trim() }, (state: LicenseState) => {
      setSubmitting(false);
      if (state?.hasAccess) {
        onChange(state);
      } else {
        setError(state?.message ?? 'Could not verify this license key.');
      }
    });
  }

  return (
    <div className="rounded-lg border border-rule bg-white p-3 shadow-card">
      <label className="mb-1 block text-xs font-medium text-ink-soft">License key</label>
      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        className="w-full rounded border border-rule px-3 py-2 text-sm outline-none focus:border-accent"
        autoFocus
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={submitting || !key.trim()}
        className="mt-2 w-full rounded bg-accent py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? 'Verifying…' : 'Activate'}
      </button>
      <p className="mt-2 text-center text-[11px] text-ink-soft">
        Purchases and billing happen on our website — this only checks whether a key is active.
      </p>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-rule bg-white py-2 shadow-card">
      <div className="font-display text-lg leading-none">{value ?? '–'}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-soft">{label}</div>
    </div>
  );
}

function ExportButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Pro feature' : undefined}
      className="flex-1 rounded border border-rule bg-white py-1.5 text-xs font-medium text-ink hover:bg-accent-soft disabled:cursor-not-allowed disabled:text-ink-soft disabled:hover:bg-white"
    >
      {disabled ? `🔒 ${label}` : label}
    </button>
  );
}
