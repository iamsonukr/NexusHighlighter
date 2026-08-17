import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// Manifest V3. Permissions follow the Chrome Web Store "Use of Permissions"
// policy: narrowest necessary, nothing requested for unimplemented features.
// - storage: local persistence of highlights/pages/settings/license
// - contextMenus: right-click "Highlight" / "Add note" actions
// - activeTab: lets the popup read the current tab's URL only when the person
//   opens the popup, so there is no standing access to tab URLs
// - downloads: the Pro export feature writes files via chrome.downloads
// - identity: Chrome Identity web auth flow for CodersNexus extension login
// - host_permissions is scoped to the license/auth domain and sync backend
// - content_scripts.matches grants page injection only on normal web pages
//   where users can create/restore highlights; host_permissions does not
//   include broad page access
// - "scripting" and "tabs" are intentionally not requested
export default defineManifest({
  manifest_version: 3,
  name: 'Nexus Highlighter',
  short_name: 'Nexus HL',
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
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: ['storage', 'contextMenus', 'activeTab', 'downloads', 'identity'],
  host_permissions: [
    'https://nexusbackend-ookk.onrender.com/*',
    'https://nexushighlighter.onrender.com/*',
  ],
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
      description: 'Open/close the Nexus Highlighter sidebar',
    },
  },
});
