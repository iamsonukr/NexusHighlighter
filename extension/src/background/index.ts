import type { ExtensionMessage, LicenseState } from '@/types';
import { EMPTY_LICENSE_STATE } from '@/types';
import { activateLicense, reverifyStoredLicense } from './license';
import { startExtensionAuth } from './extensionAuth';
import { getLicenseState, clearLicenseState, getSettings } from '@/storage/db';
import { syncAllHighlights, syncHighlight } from '@/sync/client';
import { PURCHASE_URL } from '@/constants';

// Lets already-open tabs flip between free/Pro immediately after activation
// or "change key", instead of waiting for a reload.
function broadcastLicenseState(state: LicenseState) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'LICENSE_UPDATED', state }, () => void chrome.runtime.lastError);
    });
  });
}

function broadcastHighlightsUpdated(pageIds: Set<string>) {
  if (pageIds.size === 0) return;
  chrome.tabs.query({}, (tabs) => {
    pageIds.forEach((pageId) => {
      tabs.forEach((tab) => {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHTS_UPDATED', pageId }, () => void chrome.runtime.lastError);
      });
    });
  });
}

function scheduleSyncAll(options: { fullPull?: boolean } = {}) {
  void syncAllHighlights(options)
    .then(broadcastHighlightsUpdated)
    .catch(() => undefined);
}

async function canUseCloudSync(state: LicenseState) {
  const settings = await getSettings();
  return Boolean(settings.syncToCloud && state.key && state.userId);
}

async function scheduleSyncIfAllowed(state: LicenseState, options: { fullPull?: boolean } = {}) {
  if (await canUseCloudSync(state)) scheduleSyncAll(options);
}

// ---- License re-verification cadence: on every browser start ----
chrome.runtime.onStartup.addListener(async () => {
  const state = await reverifyStoredLicense();
  broadcastLicenseState(state);
  await scheduleSyncIfAllowed(state);
});

// Also check right after install/update, in case a key was already entered
// before an update, or the service worker was asleep across a long session.
chrome.runtime.onInstalled.addListener(() => {
  reverifyStoredLicense().then((state) => {
    void scheduleSyncIfAllowed(state);
  });
  setupContextMenus();
});

// Note: service workers can be evicted and restarted by Chrome at any time.
// reverifyStoredLicense() only ever calls the network when a key is actually
// stored, so it's safe to also invoke it lazily via REVERIFY_LICENSE (see
// popup, which live-checks on every open rather than trusting the cache).

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'nm-highlight',
      title: 'Highlight',
      contexts: ['selection'],
    });
    (['yellow', 'green', 'blue'] as const).forEach((color) => {
      chrome.contextMenus.create({
        id: `nm-highlight-${color}`,
        title: `Highlight ${color[0].toUpperCase()}${color.slice(1)}`,
        contexts: ['selection'],
        parentId: 'nm-highlight',
      });
    });
    chrome.contextMenus.create({
      id: 'nm-add-note',
      title: 'Add note to selection',
      contexts: ['selection'],
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'nm-add-note') {
    chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_ADD_NOTE', selectionText: info.selectionText });
  } else if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith('nm-highlight-')) {
    const color = info.menuItemId.replace('nm-highlight-', '');
    chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_HIGHLIGHT', color, selectionText: info.selectionText });
  }
});

// ---- Keyboard shortcuts (see manifest.config.ts "commands") ----
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) return;
    if (command === 'highlight-selection') {
      chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_HIGHLIGHT', color: 'yellow' });
    } else if (command === 'add-note') {
      chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_ADD_NOTE' });
    } else if (command === 'toggle-sidebar') {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' });
    }
  });
});

// ---- Message routing (popup <-> background <-> content script) ----
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'VERIFY_LICENSE': {
        const state = await activateLicense(message.key);
        broadcastLicenseState(state);
        await scheduleSyncIfAllowed(state, { fullPull: true });
        sendResponse(state);
        break;
      }
      case 'GET_LICENSE_STATE': {
        sendResponse(await getLicenseState());
        break;
      }
      case 'OPEN_PURCHASE_PAGE': {
        chrome.tabs.create({ url: PURCHASE_URL });
        sendResponse({ success: true });
        break;
      }
      case 'START_EXTENSION_AUTH': {
        try {
          const state = await startExtensionAuth();
          broadcastLicenseState(state);
          await scheduleSyncIfAllowed(state, { fullPull: true });
          sendResponse(state);
        } catch (error) {
          sendResponse({
            ...EMPTY_LICENSE_STATE,
            status: 'invalid',
            message: error instanceof Error ? error.message : 'Could not connect CodersNexus.',
          });
        }
        break;
      }
      case 'REVERIFY_LICENSE': {
        // A live network check, not just a cache read. Used by the popup every
        // time it opens and before Pro-gated actions, so local storage edits
        // are overwritten by the real server answer quickly.
        const state = await reverifyStoredLicense();
        broadcastLicenseState(state);
        await scheduleSyncIfAllowed(state);
        sendResponse(state);
        break;
      }
      case 'CLEAR_LICENSE': {
        await clearLicenseState();
        const state = await getLicenseState();
        broadcastLicenseState(state);
        sendResponse(undefined);
        break;
      }
      case 'SYNC_HIGHLIGHT': {
        try {
          const pageIds = await syncHighlight(message.highlight);
          broadcastHighlightsUpdated(pageIds);
          sendResponse({ success: true });
        } catch {
          sendResponse({ success: false });
        }
        break;
      }
      case 'SYNC_ALL_HIGHLIGHTS': {
        try {
          const pageIds = await syncAllHighlights({ fullPull: message.fullPull });
          broadcastHighlightsUpdated(pageIds);
          sendResponse({ success: true });
        } catch {
          sendResponse({ success: false });
        }
        break;
      }
      default:
        sendResponse(undefined);
    }
  })();
  return true; // keep the message channel open for the async response
});
