# NoteMark

A web highlighter/annotation Chrome extension, structured as a monorepo with
two independent, separately-deployable workspaces:

```text
notemark/
|-- extension/     # the Chrome extension; see extension/README.md
|-- backend/       # Pro highlight-sync API; see backend/README.md
`-- package.json   # npm workspaces wiring
```

## Why separate, not just "in one repo"

- **The extension works completely on its own for local use.** Free tier,
  highlighting, notes, local persistence, and Pro unlocking via license key
  function without the sync backend. Once a Pro key is verified, the extension
  can also sync highlights through `backend/` (`http://localhost:5000/api` by
  default; set `VITE_NOTEMARK_SYNC_API_URL` and add the matching manifest
  host permission when building for a deployed sync backend).
- **`backend/` is optional for local-only use** and becomes relevant for Pro
  cloud sync. The extension talks to it through HTTP from the background
  worker rather than importing backend code directly.
- **They deploy differently.** The extension ships to the Chrome Web Store.
  The backend deploys to Render/Railway/wherever as its own service with its
  own MongoDB instance, uptime, and release cycle.
- **They fail independently.** A sync-backend outage should not break the free
  tier, licensing, or any local-only feature; failed sync calls are retried on
  later writes or license re-verification.

## Where to go next

- Working on the extension itself: `extension/README.md`
- Working on cloud sync: `backend/README.md`

## Root-level scripts

```bash
npm install
npm run extension:dev
npm run extension:build
npm run backend:dev
npm run backend:build
```

Each workspace also has its own `package.json` and can be worked on/deployed
with `cd extension` or `cd backend` directly, ignoring the root entirely if
you prefer.
