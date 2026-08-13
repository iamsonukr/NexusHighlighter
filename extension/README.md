# NoteMark — Web Highlighter, Notes & Reading Assistant

A Manifest V3 Chrome extension: select text on any webpage, highlight it, attach
a note, and have it restored automatically the next time you visit that page.

This is the **Phase 1 MVP** of the larger product brief plus a minimal Pro
highlight-sync bridge. Local persistence still works without this repo's
backend; once a license key verifies, the background worker can sync
highlights to `../backend` (`http://localhost:5000/api` by default; set
`VITE_NOTEMARK_SYNC_API_URL` and add the matching manifest host permission
for a deployed backend). There are still no accounts.

---

## 1. What's implemented

- **Text selection → floating toolbar** with 6 highlight colors, copy, dismiss
- **Robust text anchoring** (`src/content/anchoring.ts`): highlights are relocated
  using a 4-stage strategy — exact text + context, prefix/suffix scan, fuzzy
  paragraph match, CSS-selector fallback — so highlights survive minor DOM
  changes instead of breaking the moment a site redeploys its markup
- **Non-destructive rendering** (`src/content/highlighter.ts`): highlights are
  drawn by wrapping text nodes in `<nm-mark>` elements via `Range.surroundContents`,
  never via `innerHTML`, so the host page's own event listeners and React/Vue
  trees are left alone
- **Notes, per-highlight color change, delete, duplicate prevention**
- **Sidebar** listing all highlights on the current page, with search,
  click-to-scroll, inline note editing
- **Popup**: license gate, aggregate stats, current-page highlight count,
  "open sidebar" shortcut
- **Context menu** (Highlight / Highlight in a color / Add note) and
  **keyboard shortcuts** (`Alt+H`, `Alt+N`, `Alt+S`, configurable at
  `chrome://extensions/shortcuts`)
- **SPA support**: `history.pushState`/`replaceState`/`popstate` are hooked so
  highlights reload on client-side route changes (React/Vue/Next/Angular sites)
- **Dynamic content support**: a single debounced `MutationObserver` retries
  anchoring only for highlights that failed to render, only after the DOM goes
  quiet — not a continuous full-page scan
- **Local persistence + Pro sync** via `chrome.storage.local`
  (`src/storage/db.ts`) and `src/sync/client.ts`, with soft deletes
  (`deletedAt`) propagated as tombstones
- **Licensing, not accounts, with a real free tier**: no login/signup/payment
  UI anywhere in the extension. The extension is fully usable with **no key at
  all** — that's the free tier (see §3). Entering a key that verifies unlocks
  Pro.
- **Free vs. Pro gating** (`src/constants.ts`):
  - Free: highlighting, notes, colors, tags, per-page sidebar search — capped
    at 500 total highlights across all pages
  - Pro: unlimited highlights, cross-page global search (in the popup),
    PDF/Docs export — all gated behind `license.hasAccess`, re-checked
    live via a `LICENSE_UPDATED` broadcast so open tabs flip the moment a key
    is activated, with no reload needed

## 2. What's deliberately NOT in this build

Per the brief's own phased instructions (§57–58), most Phase 2 features are
still not present:

- No accounts/JWT auth. Highlight sync uses the stored license key in the
  `x-license-key` header.
- No collections, reading list, analytics dashboard, sharing — Phase 2/3
- No AI features (summarize, ask-the-page, flashcards) — Phase 3, and should
  stay opt-in per action even once added (privacy-first, see brief §24)
- No durable offline retry queue yet. Sync retries on later writes or popup
  re-verification, and applies the backend's last-write-wins conflicts.
- No Options page beyond what's in the popup — add once there are settings
  worth a dedicated page (default color, privacy toggles, shortcut remapping)

---

## 3. Licensing flow (free tier + Pro key)

There is **no login, signup, or payment inside the extension**, and no key is
required to use the core product:

1. Fresh install → free tier is active immediately (highlighting, notes,
   colors, tags, per-page sidebar search — capped at 500 total highlights)
2. Popup shows a "Free · Upgrade" badge; clicking it (or hitting the
   highlight cap, or trying Export/global search) reveals the single
   "License key" input (`src/popup/Popup.tsx`)
3. Submitting calls the background worker → `src/background/license.ts` →
   `POST https://nexusbackend-ookk.onrender.com/api/subscriptions/verify`
   with `{ productId: "6a7ae899e65a8aa481d69388", licenseKey }`
4. On `hasAccess: true`, the result is cached in `chrome.storage.local`, the
   popup badge switches to the plan name, and the background worker
   broadcasts `LICENSE_UPDATED` to every open tab so the content script lifts
   the free-tier cap immediately — no reload needed
5. **Re-verification cadence: on every browser start**, via
   `chrome.runtime.onStartup` in `src/background/index.ts` (also rebroadcast
   to open tabs)
6. If the server is unreachable, the last known access state is kept for that
   session (status shows `offline`) rather than instantly downgrading the
   user — but any real response from the server (invalid/expired) always
   overrides the cached state
7. "Change key" in the popup clears the stored license (`CLEAR_LICENSE`
   message) and drops back to the free tier

All purchasing/billing happens on your own website, entirely outside this
extension — it only ever calls the one `verify` endpoint.

## 4. Free vs. Pro

| | Free | Pro (license key) |
|---|---|---|
| Highlighting, colors, notes, tags | ✅ | ✅ |
| Per-page sidebar search | ✅ | ✅ |
| Total highlights | 500 (`FREE_HIGHLIGHT_LIMIT` in `src/constants.ts`) | Unlimited |
| Search across every saved page (popup) | ❌ | ✅ |
| Export (PDF / Docs) | ❌ | ✅ |

The free tier is intentionally generous for daily use — the cap only bites
once someone has built up a real library, which is exactly when the "go
unlimited" prompt is most likely to land. See `src/constants.ts` for a short
rationale on why it's scoped this way, and the popup's usage bar
(`src/popup/Popup.tsx`) for how the nudge is surfaced before the hard limit.

Not yet built, but designed to slot into this same `license.hasAccess` gate
once they exist: collections beyond a small free limit and AI features (see
roadmap in §10).

### What's actually enforceable, and what isn't

Worth being straight about this rather than pretending every gate is bulletproof:

- **Pro gating is now hardened, not just cached.** Earlier, `license.hasAccess`
  was read once at browser start and trusted until the next start — someone
  could hand-edit that flag in `chrome.storage` via devtools and stay "Pro"
  indefinitely. Now:
  - The popup does a **live** verify call (`REVERIFY_LICENSE`, not a cache
    read) every time it opens, and again right before an actual export —
    the two places Pro value is delivered. A tampered local flag gets
    overwritten by the real server answer within seconds of the popup being
    opened, not at the next browser restart.
  - Every open tab's content script is updated immediately via a
    `LICENSE_UPDATED` broadcast whenever the popup's live check changes the
    result, so a downgrade takes effect without a page reload.
  - The content script itself still reads from the cached flag (see below
    for why) rather than calling the network on every page load.

- **The free-tier highlight cap is, and stays, a soft client-side limit.**
  Free users never send a license key, so there's nothing for the server to
  check — enforcing it server-side would require giving free users some form
  of identity (a device ID, a lightweight anonymous account) purely to track
  a counter. That's a real design trade-off, not an oversight: it directly
  conflicts with "standalone, no accounts" and with the privacy settings
  already built into the product (§43 in the original brief — no silent
  tracking). A determined user can always reset their own local count. In
  practice this is the same trade-off most local-first free tiers make
  (data lives on-device, so the count does too); it filters casual
  free-riding without being cryptographically airtight, and closing that gap
  fully isn't worth the privacy cost.

- **Why the content script doesn't live-verify on every page load:** it
  would mean calling your license server on every single webpage the person
  visits, which is both a real latency/perf cost and a much bigger privacy
  footprint than a highlighting tool should have. The popup-triggered
  re-checks plus the once-per-browser-start check are the practical middle
  ground.

- **If you later want the free cap enforced server-side anyway,** the clean
  way to do it without full accounts is an anonymous per-install ID (e.g.
  `crypto.randomUUID()` generated once and stored locally, sent instead of a
  license key) plus a `/api/usage/free-tier` endpoint that increments and
  caps a counter keyed by that ID. That's a real backend feature to design
  and build deliberately, with its own privacy-policy implications — it's
  not something to bolt on as a side effect of a licensing tweak, so it's
  left out of this build rather than half-implemented.

---

## 5. Chrome Web Store compliance

Verified against the live [Chrome Web Store Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies) (fetched during development — last updated 2025-05-22, with a Limited Use policy update whose **enforcement began 2026-08-01**).

### What's handled in code

- **Limited Use policy — "collection and use of web browsing activity is
  prohibited except for a user-facing feature the person actually
  triggered."** Fixed: `src/content/index.tsx` no longer writes a
  `PageRecord` (title/url/domain/favicon/timestamp) on every page load. It's
  only written the moment a highlight is actually created — visiting a page
  and never highlighting on it leaves nothing in storage. This also brings
  the code in line with what `PRIVACY_POLICY.md` and this README already
  claimed.
- **Use of Permissions — "narrowest permissions necessary... don't
  future-proof by requesting permissions for unimplemented features."**
  `manifest.config.ts` requests only `storage`, `contextMenus`, `activeTab`,
  `downloads`. An earlier draft also requested `scripting`, which nothing in
  the codebase calls — removed. `host_permissions` is scoped to the license
  API's own domain only, not `<all_urls>` — content-script injection on
  every page comes from `content_scripts.matches`, which doesn't need a
  corresponding `host_permissions` entry.
- **Manifest V3 code-transparency requirement — "the full functionality of
  an extension must be discernible from its submitted code... no eval() or
  interpreter for remote strings."** No `eval`, `new Function`, or
  `innerHTML` assignment anywhere in `src/` (checked directly). The only
  network calls are `fetch()`s to the one license-verification endpoint,
  which returns data (a verification result), never executable logic — this
  is explicitly an allowed pattern under the policy's "Communicating with
  remote servers" carve-out.
- **Privacy Policy requirement.** Drafted at `PRIVACY_POLICY.md`. It's
  accurate to what the code now actually does — the "Listing Requirements"
  policy explicitly warns that a mismatch between your dashboard privacy
  fields/policy and your extension's real behavior is itself grounds for
  removal, so this needs to stay in sync with the code, not just be filled
  in once.

### What's a manual step in the Developer Dashboard (can't be done from code)

- Host `PRIVACY_POLICY.md` at a real URL and paste that URL into the
  dashboard's privacy policy field
- Fill in the "single purpose" field — suggested text: *"NoteMark lets
  users highlight and annotate text on any webpage, and shows those
  highlights again when the page is revisited."*
- Complete the dashboard's data-collection disclosure (the "Privacy
  practices" tab): declare that "Website content" (the highlighted text/
  notes) is collected, stored locally, not sold, and not used for ads —
  matching `PRIVACY_POLICY.md`
- Add a support contact/email — required by the Best Practices guidance
  ("provide meaningful customer support")
- Enable 2-Step Verification on the publishing Google account — required
  before an extension can be published or updated
- Take real screenshots and write store-listing copy that accurately
  describes what's implemented today (Phase 1 only) rather than the full
  long-term product vision — the "Misleading or Unexpected Behavior" policy
  covers store-listing claims, not just code

---

## 6. Setup

```bash
cd extension
npm install
npm run dev      # dev build with HMR, or:
npm run build     # production build → dist/
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select the `dist/` folder
4. Click the NoteMark icon, enter a license key to activate

## 7. Project structure

```text
extension/                    # this workspace — independent from ../backend
├── manifest.config.ts     # MV3 manifest (via @crxjs/vite-plugin)
├── vite.config.ts
├── src/
│   ├── background/
│   │   ├── index.ts        # startup license check, context menus, shortcuts, message router
│   │   └── license.ts       # verify-endpoint client (activate + silent re-verify)
│   ├── content/
│   │   ├── index.tsx        # shadow-DOM mount, selection handling, restore, SPA + MutationObserver
│   │   ├── anchoring.ts      # 4-stage text anchoring/recovery
│   │   ├── highlighter.ts    # safe DOM rendering of <nm-mark> wrappers
│   │   ├── Toolbar.tsx        # floating color-picker toolbar
│   │   ├── Sidebar.tsx        # per-page highlights panel
│   │   └── content.css        # Tailwind, injected into the shadow root only
│   ├── popup/
│   │   ├── Popup.tsx          # license gate + stats dashboard
│   │   ├── export.ts           # Pro-gated PDF/Docs export
│   │   ├── main.tsx
│   │   └── index.html
│   ├── storage/
│   │   └── db.ts               # chrome.storage.local wrapper (highlights/pages/settings/license)
│   ├── types/index.ts           # Highlight, PageRecord, License*, message types
│   ├── constants.ts               # free-tier limits
│   └── utils/url.ts                # canonical URL, domain, page-id helpers
└── public/icons/
```

This extension keeps its local source of truth in `chrome.storage.local`,
calls the license-verify service for Pro access, and syncs Pro highlights
through the separate backend described in `../backend/README.md`.

## 8. The critical persistence test (brief §46)

Before trusting this on real content, verify manually:

1. Open a text-heavy article, highlight a sentence, add a note + reload the tab
   → highlight should reappear in the same place
2. Close and reopen Chrome entirely, revisit the same URL → highlight should
   still be there
3. Slightly edit the page's DOM via devtools (wrap the highlighted paragraph in
   a new `<div>`, or add text before it) → the anchoring fallback chain should
   still recover the highlight; if it genuinely can't, the highlight is simply
   not drawn rather than mis-placed on the wrong text

## 9. Known limitations (be upfront about these)

- Anchoring strategy 1 does a full-body text scan per highlight; on pages with
  thousands of highlights this should move to a single combined pass — fine
  for normal reading-length pages today
- `chrome.storage.local` stores one JSON blob per bucket; if a single user
  accumulates tens of thousands of highlights, switch `src/storage/db.ts` to
  IndexedDB (the function signatures are already written so nothing above
  this layer would need to change)
- No `all_frames` support yet — highlighting inside iframes (e.g. embedded
  articles) isn't covered
- Conflict handling is intentionally simple: the backend returns the newer
  record and the extension applies it locally.

## 10. Roadmap (Phase 2 onward, per the original brief)

- **Phase 2** — `../backend` now has a real scaffold: Node/Express/MongoDB,
  highlight sync scoped by license key (not JWT/accounts — see
  `../backend/README.md` for why), last-write-wins conflict resolution, and
  extension-side push/pull wiring through `src/sync/client.ts`.
- **Phase 3** — Notes/tags/collections dashboard, bookmarks, reading list,
  CSV export and richer export templates
- **Phase 4** — Reader mode, analytics, sharing, command palette
- **Phase 5** — Opt-in AI features (summarize, ask-the-page, flashcards, quiz),
  each gated behind an explicit per-action confirmation, never automatic
