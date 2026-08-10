import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// Manifest V3. Permissions follow the Chrome Web Store "Use of Permissions"
// policy: narrowest necessary, nothing requested for unimplemented features.
// - storage: local persistence of highlights/pages/settings/license
// - contextMenus: right-click "Highlight" / "Add note" actions
// - activeTab: lets the popup read the current tab's URL (for the
//   current-page highlight count) only when the person actually opens the
//   popup — no standing access to tab URLs otherwise
// - downloads: the Pro export feature (Markdown/JSON) writes a file via
//   chrome.downloads rather than a page-level anchor click
// - host_permissions is scoped to ONLY the license verification domain, so
//   the background worker's fetch() isn't subject to CORS for that one call.
//   It deliberately does NOT include "<all_urls>" — content_scripts.matches
//   below grants content-script injection on its own and needs no
//   corresponding host_permissions entry.
// - "scripting" and "tabs" are intentionally NOT requested: nothing in this
//   codebase calls chrome.scripting.* or needs cross-tab URL/title access
//   beyond what activeTab already covers.
export default defineManifest({
  manifest_version: 3,
  name: 'NoteMark — Highlight, Annotate, Remember',
  short_name: 'NoteMark',
  version: pkg.version,
  description:
    'Highlight, annotate, and organize anything you read on the web. Your highlights stay right where you left them.',
  icons: {
    16: 'public/icons/icon16.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'public/icons/icon16.png',
      48: 'public/icons/icon48.png',
      128: 'public/icons/icon128.png',
    },
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: ['storage', 'contextMenus', 'activeTab', 'downloads'],
  host_permissions: ['https://nexusbackend-ookk.onrender.com/*'],
  // Explicit MV3 CSP: extension pages may only load scripts bundled in the
  // package itself, matching the "Additional Requirements for Manifest V3"
  // policy (no <script src> to anything outside the extension, no eval-style
  // execution of remote strings). This is MV3's default, stated here so it
  // can't silently drift.
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
  commands: {
    'highlight-selection': {
      suggested_key: { default: 'Alt+H' },
      description: 'Highlight the current selection',
    },
    'add-note': {
      suggested_key: { default: 'Alt+N' },
      description: 'Add a note to the current selection',
    },
    'toggle-sidebar': {
      suggested_key: { default: 'Alt+S' },
      description: 'Open/close the NoteMark sidebar',
    },
  },
});
