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
  pageIdFor,
  uid,
} from '@/utils/url';
import {
  getHighlightsForPage,
  getAllHighlights,
  upsertHighlight,
  deleteHighlight as deleteHighlightRecord,
  findDuplicateHighlight,
  upsertPage,
  getLicenseState,
} from '@/storage/db';
import { FREE_HIGHLIGHT_LIMIT } from '@/constants';
import type { Highlight, HighlightColor, LicenseState } from '@/types';

// ---------------------------------------------------------------------------
// Licensing: the extension is fully usable with no key at all (free tier).
// A verified key (hasAccess: true) lifts the free-tier limits. No login/
// signup UI lives here — activation only happens in the popup.
// ---------------------------------------------------------------------------
main();

async function main() {
  let pageId = pageIdFor(getCanonicalUrl());
  let highlights: Highlight[] = await getHighlightsForPage(pageId);
  let license: LicenseState = await getLicenseState();
  let isPro = license.hasAccess;

  // NOTE: page metadata (title/url/domain/favicon) is intentionally NOT
  // recorded here on every page load. Chrome Web Store's Limited Use policy
  // prohibits collecting web browsing activity except for a user-facing
  // feature the person actually triggered — so a PageRecord is only written
  // inside handleCreateHighlight(), at the moment the person highlights
  // something. Visiting a page and never highlighting on it leaves zero
  // trace in storage. See README "Chrome Web Store compliance".

  // ---- Shadow root: keeps our React UI's CSS fully isolated from the host
  // page (and the host page's CSS from us). Highlight <nm-mark> elements are
  // NOT inside this root — they live inline in the page, styled via inline
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
  let upsellMessage: string | null = null;

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
            onClose={() => {
              sidebarOpen = false;
              render();
            }}
            onSelect={(id) => scrollToHighlight(id)}
            onRecolor={handleRecolor}
            onDelete={handleDelete}
            onSaveNote={handleSaveNote}
          />
        )}
        {upsellMessage && (
          <UpsellBanner
            message={upsellMessage}
            onDismiss={() => {
              upsellMessage = null;
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

  async function handleCreateHighlight(color: HighlightColor) {
    if (!toolbarState) return;
    const range = toolbarState.range;
    const anchor = captureAnchor(range);
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
      highlights = highlights.map((h) => (h.id === dup.id ? dup : h));
      render();
      return;
    }

    // Free-tier cap: checked against the user's TOTAL highlight count across
    // every page, not just this one — see src/constants.ts.
    if (!isPro) {
      const total = (await getAllHighlights()).length;
      if (total >= FREE_HIGHLIGHT_LIMIT) {
        upsellMessage = `You've reached the free limit of ${FREE_HIGHLIGHT_LIMIT} highlights. Enter a license key in the NoteMark popup to go unlimited.`;
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
      canonicalUrl: getCanonicalUrl(),
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
      canonicalUrl: getCanonicalUrl(),
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
    highlights = [...highlights, highlight];
    render();
  }

  async function handleRecolor(id: string, color: HighlightColor) {
    recolorHighlight(id, color);
    const h = highlights.find((x) => x.id === id);
    if (!h) return;
    const updated = { ...h, color, updatedAt: Date.now() };
    await upsertHighlight(updated);
    highlights = highlights.map((x) => (x.id === id ? updated : x));
    render();
  }

  async function handleDelete(id: string) {
    removeHighlight(id);
    await deleteHighlightRecord(id);
    highlights = highlights.filter((x) => x.id !== id);
    render();
  }

  async function handleSaveNote(id: string, note: string) {
    const h = highlights.find((x) => x.id === id);
    if (!h) return;
    const updated = { ...h, note: note.trim() || null, updatedAt: Date.now() };
    await upsertHighlight(updated);
    highlights = highlights.map((x) => (x.id === id ? updated : x));
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
      // see product brief §44 for the "page changed" messaging this enables.
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
      sidebarOpen = true;
      render();
    } else if (message?.type === 'LICENSE_UPDATED') {
      license = message.state as LicenseState;
      isPro = license.hasAccess;
      if (isPro) {
        upsellMessage = null;
        render();
      }
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
    highlights = await getHighlightsForPage(pageId);
    // No page-metadata write here either — same rule as main(): a
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
  // failed to anchor, and only after the DOM has been quiet for a moment —
  // never on every single mutation, which would thrash performance on
  // content-heavy or ad-laden pages (see product brief §31, §50).
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
  observer.observe(document.body, { childList: true, subtree: true });
}
