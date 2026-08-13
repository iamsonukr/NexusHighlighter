import { useEffect, useRef, useState } from 'react';
import type { Highlight, LicenseState } from '@/types';
import { EMPTY_LICENSE_STATE } from '@/types';
import { getStats, getHighlightsForPage, getAllHighlights, getAllPages, searchHighlights } from '@/storage/db';
import { normalizeUrl, pageIdFor, getDomain } from '@/utils/url';
import { FREE_HIGHLIGHT_LIMIT, HIGHLIGHT_WARNING_THRESHOLD, PURCHASE_URL } from '@/constants';
import { buildWordExport, downloadPdfExport, downloadTextFile } from './export';

type Stats = Awaited<ReturnType<typeof getStats>>;
type PremiumTooltipTarget = 'search' | 'export';

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
      resolve(state ?? EMPTY_LICENSE_STATE);
    });
  });
}

export function Popup() {
  const [license, setLicense] = useState<LicenseState>(EMPTY_LICENSE_STATE);
  const [loadingLicense, setLoadingLicense] = useState(true);
  const [connectingAccount, setConnectingAccount] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
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
      setAuthError(error instanceof Error ? error.message : 'Could not connect CodersNexus.');
    } finally {
      setConnectingAccount(false);
    }
  }

  return (
    <Dashboard
      license={license}
      authError={authError}
      connectingAccount={connectingAccount}
      showKeyBox={showKeyBox || (!license.userId && license.status === 'invalid')}
      onConnect={connectAccount}
      onRequestUpgrade={() => setShowKeyBox(true)}
      onPurchase={openPurchasePage}
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
  authError,
  connectingAccount,
  showKeyBox,
  onConnect,
  onRequestUpgrade,
  onPurchase,
  onLicenseChange,
}: {
  license: LicenseState;
  authError: string | null;
  connectingAccount: boolean;
  showKeyBox: boolean;
  onConnect: () => void;
  onRequestUpgrade: () => void;
  onPurchase: () => void;
  onLicenseChange: (state: LicenseState) => void;
}) {
  const isPro = license.hasAccess;
  const isConnected = Boolean(license.key && license.userId);
  const [stats, setStats] = useState<Stats | null>(null);
  const [currentPageCount, setCurrentPageCount] = useState<number | null>(null);
  const [currentDomain, setCurrentDomain] = useState<string>('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Highlight[] | null>(null);
  const [premiumTooltip, setPremiumTooltip] = useState<{ target: PremiumTooltipTarget; message: string } | null>(null);
  const tooltipTimer = useRef<number | undefined>();

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

  useEffect(() => {
    return () => window.clearTimeout(tooltipTimer.current);
  }, []);

  function showPremiumTooltip(target: PremiumTooltipTarget, message: string) {
    if (isPro) return;
    window.clearTimeout(tooltipTimer.current);
    setPremiumTooltip({ target, message });
    tooltipTimer.current = window.setTimeout(() => setPremiumTooltip(null), 4000);
  }

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

  async function exportAs(format: 'pdf' | 'doc') {
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
    if (format === 'pdf') {
      await downloadPdfExport(highlights, pages);
    } else {
      downloadTextFile('notemark-study-notes.doc', buildWordExport(highlights, pages), 'application/msword');
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
        <PlanBadge license={license} onClick={onConnect} />
      </div>

      <div className="mb-3">
        <input
          value={query}
          onChange={(e) => {
            if (!isPro) {
              showPremiumTooltip('search', 'Premium feature: buy a plan to search across every saved page.');
              return;
            }
            runSearch(e.target.value);
          }}
          onFocus={() =>
            !isPro && showPremiumTooltip('search', 'Premium feature: buy a plan to search across every saved page.')
          }
          onPointerDown={() =>
            !isPro && showPremiumTooltip('search', 'Premium feature: buy a plan to search across every saved page.')
          }
          placeholder={isPro ? 'Search all your highlights…' : 'Search this page in the sidebar →'}
          readOnly={!isPro}
          aria-disabled={!isPro}
          className={`w-full rounded border border-rule px-3 py-1.5 text-sm outline-none focus:border-accent ${
            isPro ? 'bg-white' : 'cursor-not-allowed bg-rule/30 text-ink-soft'
          }`}
        />
        {premiumTooltip?.target === 'search' && (
          <PremiumTooltip
            message={premiumTooltip.message}
            onPurchase={onPurchase}
            onRequestUpgrade={onRequestUpgrade}
          />
        )}
        {!isPro && (
          <p className="mt-1 text-[11px] text-ink-soft">
            Searching across every saved page is a{' '}
            <button className="font-medium text-accent underline" onClick={onPurchase}>
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
              <button className="underline" onClick={onPurchase}>
                buy a plan
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

      <div className="mb-2 grid grid-cols-2 gap-2">
        <ExportButton
          label="Export PDF"
          locked={!isPro}
          onLockedAttempt={() => showPremiumTooltip('export', 'Premium feature: buy a plan to export PDF or Word notes.')}
          onClick={() => exportAs('pdf')}
        />
        <ExportButton
          label="Export Docs"
          locked={!isPro}
          onLockedAttempt={() => showPremiumTooltip('export', 'Premium feature: buy a plan to export PDF or Word notes.')}
          onClick={() => exportAs('doc')}
        />
      </div>
      {premiumTooltip?.target === 'export' && (
        <div className="-mt-2 mb-3">
          <PremiumTooltip
            message={premiumTooltip.message}
            onPurchase={onPurchase}
            onRequestUpgrade={onRequestUpgrade}
          />
        </div>
      )}
      {!isPro && (
        <p className="-mt-2 mb-3 text-[11px] text-ink-soft">
          PDF and Docs export are{' '}
          <button className="font-medium text-accent underline" onClick={onPurchase}>
            Pro
          </button>{' '}
          features.
        </p>
      )}

      {showKeyBox ? (
        <LicenseBox license={license} onPurchase={onPurchase} onChange={onLicenseChange} />
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
      ) : isConnected ? (
        <div className="space-y-2 text-center text-[11px] text-ink-soft">
          <p>
            {license.userFullName ? `Connected as ${license.userFullName}` : 'CodersNexus connected'}
            {license.planName ? ` - ${license.planName}` : ' - Starter'}
          </p>
          <button onClick={onPurchase} className="w-full text-center text-xs font-medium text-accent underline">
            Buy or upgrade a plan
          </button>
          <button
            className="w-full text-center text-xs font-medium text-accent underline"
            onClick={() =>
              chrome.runtime.sendMessage({ type: 'CLEAR_LICENSE' }, () => onLicenseChange(EMPTY_LICENSE_STATE))
            }
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            onClick={onConnect}
            disabled={connectingAccount}
            className="w-full rounded bg-marker-yellow py-2 text-sm font-medium text-ink hover:brightness-95"
          >
            {connectingAccount ? 'Connecting...' : 'Connect CodersNexus account'}
          </button>
          {authError && <p className="text-center text-xs text-red-600">{authError}</p>}
          <button onClick={onPurchase} className="w-full text-center text-xs font-medium text-accent underline">
            Buy or upgrade a plan
          </button>
          <button onClick={onRequestUpgrade} className="w-full text-center text-xs font-medium text-accent underline">
            Have a license key? Enter it here
          </button>
        </div>
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
  if (license.key && license.userId) {
    return (
      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
        {license.planName ?? 'Starter'}
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      className="rounded-full bg-marker-yellow px-2 py-0.5 text-[11px] font-medium text-ink hover:brightness-95"
    >
      Free · Sign in
    </button>
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
        Need a key?{' '}
        <button className="font-medium text-accent underline" onClick={onPurchase}>
          Buy plan
        </button>
        . Activation only checks whether your key is active.
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

function PremiumTooltip({
  message,
  onPurchase,
  onRequestUpgrade,
}: {
  message: string;
  onPurchase: () => void;
  onRequestUpgrade: () => void;
}) {
  return (
    <div
      role="tooltip"
      className="mt-2 rounded border border-accent/30 bg-accent-soft px-3 py-2 text-[11px] leading-snug text-ink shadow-card"
    >
      <p>{message}</p>
      <div className="mt-2 flex gap-3">
        <button className="font-medium text-accent underline" onClick={onPurchase}>
          Buy plan
        </button>
        <button className="font-medium text-accent underline" onClick={onRequestUpgrade}>
          Enter key
        </button>
      </div>
    </div>
  );
}

function ExportButton({
  label,
  locked,
  onLockedAttempt,
  onClick,
}: {
  label: string;
  locked: boolean;
  onLockedAttempt: () => void;
  onClick: () => void;
}) {
  return (
    <button
      onClick={locked ? onLockedAttempt : onClick}
      onFocus={() => locked && onLockedAttempt()}
      aria-disabled={locked}
      title={locked ? 'Premium feature' : undefined}
      className={`flex-1 rounded border border-rule bg-white py-1.5 text-xs font-medium hover:bg-accent-soft ${
        locked ? 'cursor-not-allowed text-ink-soft hover:bg-white' : 'text-ink'
      }`}
    >
      {locked ? `Locked ${label}` : label}
    </button>
  );
}
