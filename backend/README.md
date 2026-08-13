# NoteMark Backend (Phase 2 scaffold)

An independent Node/Express/TypeScript/MongoDB service for **cloud sync of
highlights** — the one Phase 2 feature actually implemented here end-to-end,
as a real reference rather than a folder of empty stubs.

**This is deployed completely separately from the extension.** The extension
works fully (free tier) with no backend at all, and talks to *this* service
for Pro highlight sync from the background worker. It is a different,
additional thing from the
license-verification server at `nexusbackend-ookk.onrender.com`, which
already exists, is already live, and is not part of this repo.

## Why license keys instead of user accounts

The product's licensing model has no login/signup (see `../extension/README.md`
§3) — the extension identifies itself with a license key, not a JWT-authed
account. This backend follows the same model rather than bolting real
accounts on top just for sync:

- Every request to a protected route sends the license key in an
  `x-license-key` header
- `src/middleware/requireLicense.ts` re-verifies that key against the SAME
  external license server the extension itself calls — never trusts a
  client's bare claim of being "Pro" — and only then lets the request through
- The license server's verified `user.id` is hashed and used as the sync owner,
  so highlights follow the customer across renewals or replacement keys
- The raw license key and raw external user id are never stored in this backend
  database; only deterministic lookup hashes are stored

## What's implemented vs. stubbed

**Implemented (real, working code):**
- `GET /api/highlights?since=<timestamp>` — incremental pull
- `POST /api/highlights` — upsert with last-write-wins conflict resolution
- `DELETE /api/highlights/:clientId` — soft delete (propagates to other devices)
- License verification middleware, request validation (Zod), structured
  logging that never logs secrets or note content, helmet + CORS + body-size
  limits

**Not implemented — see the original product brief §26–27 for the full
target shape, and don't assume it exists just because a model/route name
sounds familiar:**
- Pages/Notes/Tags/Collections/Bookmarks endpoints (only Highlight and Page
  models exist; Page isn't wired to a route yet)
- Search (`/api/search`) — was Atlas/Elasticsearch in the original brief
- Export, sharing, billing/subscription-status webhooks
- Rate limiting (helmet + a body-size cap are in place; a proper rate
  limiter — e.g. `express-rate-limit` or Redis-backed — isn't yet)
- Automated tests

## How this connects to the extension

The extension background worker calls this service after a valid Pro license
is present:
1. `POST /api/highlights` after local create/update/delete. Deletes are sent
   as soft-delete tombstones (`deletedAt`) so they can propagate.
2. `GET /api/highlights?since=<lastSyncedAt>` after activation/reverification
   to pull remote changes into `chrome.storage.local`. Activation performs a
   full pull; later checks use an incremental cursor scoped to the verified
   sync owner.
3. `conflict: true` responses are applied by saving the server's newer record
   locally.

The default extension sync URL is `http://localhost:5000/api`. When building
against a deployed backend, set `VITE_NOTEMARK_SYNC_API_URL` and add that
origin to `extension/manifest.config.ts` `host_permissions`.

## Setup

```bash
cd backend
cp .env.example .env   # fill in MONGODB_URI at minimum
npm install
npm run dev             # tsx watch, restarts on change
```

`GET /api/health` should return `{"success":true,"message":"ok"}` once it's
running and connected to MongoDB.

## Deployment

Deploy this independently of the extension — Render, Railway, Fly.io, or a
container platform of your choice all work with the plain
Express/Node/MongoDB stack here. It does not need to live on the same
service as `nexusbackend-ookk.onrender.com`; keeping the license server and
this sync backend as separate deployable units (even if eventually run by
the same team) keeps a licensing-server outage from taking sync down too,
and vice versa.

## A CORS note

`cors()` here is configured for a hypothetical future web dashboard, not for
the extension itself — requests from the extension's background service
worker aren't subject to the same-origin/CORS restrictions a webpage's
fetch() would be, the way `host_permissions` in `manifest.config.ts` already
handles that on the extension side. Don't add extension-related origins to
`CLIENT_URL` expecting it to matter; it won't.
