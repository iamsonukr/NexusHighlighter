import { createRoot, type Root } from 'react-dom/client';
import contentStyles from './content.css?inline';
import { Toolbar } from './Toolbar';
import { Sidebar } from './Sidebar';
import { UpsellBanner } from './UpsellBanner';
import { captureAnchor, locateAnchor } from './anchoring';
import {
  renderHighlight,
  removeAllHighlights,
  removeHighlight,
  recolorHighlight,
  scrollToHighlight,
} from './highlighter';
import {
  getCanonicalUrl,
  getDomain,
  getPageTitle,
  getPageDescription,
  getFavicon,
  getPageUrlCandidates,
  pageIdFor,
  uid,
} from '@/utils/url';
import {
  getHighlightsForPageIdentity,
  getAllHighlights,
  upsertHighlight,
  deleteHighlight as deleteHighlightRecord,
  findDuplicateHighlight,
  upsertPage,
  getLicenseState,
} from '@/storage/db';
import { REGISTERED_HIGHLIGHT_LIMIT, UNREGISTERED_HIGHLIGHT_LIMIT } from '@/constants';
import type { Highlight, HighlightColor, LicenseState } from '@/types';

// ---------------------------------------------------------------------------
// Licensing: the extension is fully usable with no key at all (free tier).
// A verified key (hasAccess: true) lifts the free-tier limits. No login/
// signup UI lives here - activation only happens in the popup.
// ---------------------------------------------------------------------------
main();

function getHighlightLimit(state: LicenseState) {
  if (state.hasAccess) return Number.POSITIVE_INFINITY;
  return state.key && state.userId ? REGISTERED_HIGHLIGHT_LIMIT : UNREGISTERED_HIGHLIGHT_LIMIT;
}

async function main() {
  let pageId = pageIdFor(getCanonicalUrl());
  let highlights: Highlight[] = await getHighlightsForPageIdentity(pageId, getPageUrlCandidates());
  let license: LicenseState = await getLicenseState();
  let highlightLimit = getHighlightLimit(license);

  // NOTE: page metadata (title/url/domain/favicon) is intentionally NOT
  // recorded here on every page load. Chrome Web Store's Limited Use policy
  // prohibits collecting web browsing activity except for a user-facing
  // feature the person actually triggered - so a PageRecord is only written
  // inside handleCreateHighlight(), at the moment the person highlights
  // something. Visiting a page and never highlighting on it leaves zero
  // trace in storage. See README "Chrome Web Store compliance".

  // ---- Shadow root: keeps our React UI's CSS fully isolated from the host
  // page (and the host page's CSS from us). Highlight <nm-mark> elements are
  // NOT inside this root - they live inline in the page, styled via inline
  // style attributes (see highlighter.ts) precisely so they render in flow.
  const hostEl = document.createElement('div');
  hostEl.id = 'notemark-root';
  hostEl.setAttribute('data-notemark-ui', '');
  document.documentElement.appendChild(hostEl);
  const shadow = hostEl.attachShadow({ mode: 'open' });
  const styleTag = document.createElement('style');
  styleTag.textContent = contentStyles;
  shadow.appendChild(styleTag);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  const root: Root = createRoot(mountPoint);

  let toolbarState: { x: number; y: number; range: Range } | null = null;
  let sidebarOpen = false;
  let editingHighlightId: string | null = null;
  let upsell: { message: string; actionLabel: string; action: 'register' | 'upgrade' } | null = null;

  function requestHighlightSync(highlight: Highlight) {
    chrome.runtime.sendMessage({ type: 'SYNC_HIGHLIGHT', highlight }, () => void chrome.runtime.lastError);
  }

  async function reloadPageHighlights() {
    removeAllHighlights();
    const canonicalUrl = getCanonicalUrl();
    pageId = pageIdFor(canonicalUrl);
    highlights = await getHighlightsForPageIdentity(pageId, getPageUrlCandidates());
    restoreHighlights();
    render();
  }

  function render() {
    root.render(
      <>
        {toolbarState && (
          <Toolbar
            x={toolbarState.x}
            y={toolbarState.y}
            onPick={(color) => handleCreateHighlight(color)}
            onCopy={() => {
              if (toolbarState) navigator.clipboard.writeText(toolbarState.range.toString());
            }}
            onClose={() => {
              toolbarState = null;
              render();
            }}
          />
        )}
        {sidebarOpen && (
          <Sidebar
            highlights={highlights}
            editingHighlightId={editingHighlightId}
            onClose={() => {
              sidebarOpen = false;
              editingHighlightId = null;
              render();
            }}
            onSelect={(id) => scrollToHighlight(id)}
            onRecolor={handleRecolor}
            onDelete={handleDelete}
            onSaveNote={handleSaveNote}
          />
        )}
        {upsell && (
          <UpsellBanner
            message={upsell.message}
            actionLabel={upsell.actionLabel}
            onAction={() =>
              chrome.runtime.sendMessage({
                type: upsell?.action === 'register' ? 'START_EXTENSION_AUTH' : 'OPEN_PURCHASE_PAGE',
              })
            }
            onDismiss={() => {
              upsell = null;
              render();
            }}
          />
        )}
      </>
    );
  }

  // ---- Selection -> floating toolbar ----
  document.addEventListener('mouseup', (e) => {
    if ((e.target as HTMLElement)?.closest?.('[data-notemark-ui]')) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!selection || !text || selection.rangeCount === 0) {
        if (toolbarState) {
          toolbarState = null;
          render();
        }
        return;
      }
      const range = selection.getRangeAt(0).cloneRange();
      const rect = range.getBoundingClientRect();
      toolbarState = { x: rect.left + rect.width / 2, y: rect.top - 10, range };
      render();
    }, 0);
  });

  async function handleCreateHighlight(color: HighlightColor, options: { openNote?: boolean } = {}) {
    if (!toolbarState) return;
    const range = toolbarState.range;
    const anchor = captureAnchor(range);
    const canonicalUrl = getCanonicalUrl();
    pageId = pageIdFor(canonicalUrl);
    highlights = await getHighlightsForPageIdentity(pageId, getPageUrlCandidates());
    toolbarState = null;
    if (!anchor) {
      render();
      return;
    }

    const dup = await findDuplicateHighlight(pageId, anchor.selectedText);
    if (dup) {
      recolorHighlight(dup.id, color);
      dup.color = color;
      dup.updatedAt = Date.now();
      await upsertHighlight(dup);
      requestHighlightSync(dup);
      highlights = highlights.map((h) => (h.id === dup.id ? dup : h));
      if (options.openNote) {
        sidebarOpen = true;
        editingHighlightId = dup.id;
      }
      render();
      return;
    }

    // Free-tier cap: checked against the user's TOTAL highlight count across
    // every page, not just this one - see src/constants.ts.
    if (Number.isFinite(highlightLimit)) {
      const total = (await getAllHighlights()).length;
      if (total >= highlightLimit) {
        const isRegistered = Boolean(license.key && license.userId);
        upsell = isRegistered
          ? {
              message: `You have reached ${REGISTERED_HIGHLIGHT_LIMIT} free highlights. Upgrade to keep growing your research library.`,
              actionLabel: 'View upgrade options',
              action: 'upgrade',
            }
          : {
              message: `You have reached ${UNREGISTERED_HIGHLIGHT_LIMIT} highlights. Register free to unlock up to ${REGISTERED_HIGHLIGHT_LIMIT} highlights.`,
              actionLabel: `Unlock ${REGISTERED_HIGHLIGHT_LIMIT} Free Highlights`,
              action: 'register',
            };
        render();
        return;
      }
    }

    const id = uid('hl');
    renderHighlight(range, id, color);

    // First highlight on this page: this is the one moment we write a
    // PageRecord at all (see the note at the top of main()).
    await upsertPage({
      id: pageId,
      url: location.href,
      canonicalUrl,
      domain: getDomain(location.href),
      title: getPageTitle(),
      description: getPageDescription(),
      favicon: getFavicon(),
      readingStatus: 'reading',
      lastVisitedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const highlight: Highlight = {
      id,
      userId: 'local',
      pageId,
      url: location.href,
      canonicalUrl,
      domain: getDomain(location.href),
      pageTitle: getPageTitle(),
      anchor,
      color,
      note: null,
      tags: [],
      isPinned: false,
      isArchived: false,
      isSynced: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    };
    await upsertHighlight(highlight);
    requestHighlightSync(highlight);
    highlights = [...highlights, highlight];
    if (options.openNote) {
      sidebarOpen = true;
      editingHighlightId = id;
    }
    render();
  }

  async function handleRecolor(id: string, color: HighlightColor) {
    recolorHighlight(id, color);
    const h = highlights.find((x) => x.id === id);
    if (!h) return;
    const updated = { ...h, color, updatedAt: Date.now() };
    await upsertHighlight(updated);
    requestHighlightSync(updated);
    highlights = highlights.map((x) => (x.id === id ? updated : x));
    render();
  }

  async function handleDelete(id: string) {
    removeHighlight(id);
    const deleted = await deleteHighlightRecord(id);
    if (deleted) requestHighlightSync(deleted);
    highlights = highlights.filter((x) => x.id !== id);
    render();
  }

  async function handleSaveNote(id: string, note: string) {
    const h = highlights.find((x) => x.id === id);
    if (!h) return;
    const updated = { ...h, note: note.trim() || null, updatedAt: Date.now() };
    await upsertHighlight(updated);
    requestHighlightSync(updated);
    highlights = highlights.map((x) => (x.id === id ? updated : x));
    if (editingHighlightId === id) editingHighlightId = null;
    render();
  }

  // ---- Restore highlights already saved for this page ----
  function restoreHighlights() {
    highlights.forEach((h) => {
      const located = locateAnchor(h.anchor);
      if (located) {
        renderHighlight(located.range, h.id, h.color);
      }
      // If not found, the highlight simply isn't rendered on the page (its
      // note/text are still visible and editable from the sidebar/dashboard);
      // see product brief section 44 for the "page changed" messaging this enables.
    });
  }
  restoreHighlights();
  render();

  // ---- Messages from background (context menu / keyboard shortcuts / popup) ----
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'TOGGLE_SIDEBAR' || message?.type === 'OPEN_SIDEBAR') {
      sidebarOpen = message.type === 'OPEN_SIDEBAR' ? true : !sidebarOpen;
      render();
    } else if (message?.type === 'CONTEXT_HIGHLIGHT') {
      const selection = window.getSelection();
      if (selection && selection.toString().trim()) {
        toolbarState = {
          x: 0,
          y: 0,
          range: selection.getRangeAt(0).cloneRange(),
        };
        handleCreateHighlight((message.color as HighlightColor) ?? 'yellow');
      }
    } else if (message?.type === 'CONTEXT_ADD_NOTE') {
      const selection = window.getSelection();
      if (selection && selection.toString().trim() && selection.rangeCount > 0) {
        toolbarState = {
          x: 0,
          y: 0,
          range: selection.getRangeAt(0).cloneRange(),
        };
        void handleCreateHighlight('yellow', { openNote: true });
      } else {
        sidebarOpen = true;
        render();
      }
    } else if (message?.type === 'LICENSE_UPDATED') {
      license = message.state as LicenseState;
      highlightLimit = getHighlightLimit(license);
      if (license.hasAccess || (license.key && license.userId)) {
        upsell = null;
        render();
      }
    } else if (message?.type === 'HIGHLIGHTS_UPDATED' && message.pageId === pageId) {
      void reloadPageHighlights();
    }
  });

  // ---- SPA navigation support ----
  // React/Vue/Next/Angular apps swap content without a full reload. We patch
  // history.pushState/replaceState (the two ways SPAs change the URL
  // programmatically) and also listen for popstate (back/forward), then
  // re-run the whole "load highlights for this URL" flow.
  let lastUrl = location.href;
  async function handleUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    removeAllHighlights();
    pageId = pageIdFor(getCanonicalUrl());
    highlights = await getHighlightsForPageIdentity(pageId, getPageUrlCandidates());
    // No page-metadata write here either - same rule as main(): a
    // PageRecord is only ever written at the moment of an actual highlight.
    restoreHighlights();
    render();
  }

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = (...args) => {
    originalPushState(...args);
    handleUrlChange();
  };
  history.replaceState = (...args) => {
    originalReplaceState(...args);
    handleUrlChange();
  };
  window.addEventListener('popstate', handleUrlChange);

  // ---- Dynamic content support ----
  // Debounced MutationObserver: only re-attempt recovery for highlights that
  // failed to anchor, and only after the DOM has been quiet for a moment -
  // never on every single mutation, which would thrash performance on
  // content-heavy or ad-laden pages (see product brief section 31, section 50).
  let debounceTimer: number | undefined;
  const observer = new MutationObserver(() => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      const unrendered = highlights.filter((h) => !document.querySelector(`nm-mark[data-nm-id="${h.id}"]`));
      unrendered.forEach((h) => {
        const located = locateAnchor(h.anchor);
        if (located) renderHighlight(located.range, h.id, h.color);
      });
    }, 800);
  });
  const observeRoot = document.body || document.documentElement;
  if (observeRoot) observer.observe(observeRoot, { childList: true, subtree: true });
}
