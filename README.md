# NoteMark

A web highlighter/annotation Chrome extension, structured as a monorepo with
two **independent, separately-deployable** workspaces:

```text
notemark/
├── extension/     # the Chrome extension — see extension/README.md
├── backend/       # optional Phase 2 cloud-sync API — see backend/README.md
└── package.json    # npm workspaces wiring, nothing else
```

## Why separate, not just "in one repo"

- **The extension works completely on its own.** Free tier, highlighting,
  notes, local persistence, and Pro unlocking via license key all function
  with zero backend of ours involved — the only network call the extension
  ever makes is to your already-live license-verification server
  (`nexusbackend-ookk.onrender.com`), which isn't part of this repo either.
- **`backend/` is 100% optional** and only becomes relevant if/when you wire
  in cloud sync. Nothing in `extension/` imports from or depends on
  `backend/` — you could delete the `backend/` folder entirely and the
  extension would build and run exactly the same.
- **They deploy differently.** The extension ships to the Chrome Web Store.
  The backend (if you build it out) deploys to Render/Railway/wherever, as
  its own service with its own MongoDB instance, its own uptime, its own
  release cycle — independent of extension version releases.
- **They fail independently.** A backend outage shouldn't be able to break
  the free tier, licensing, or any local-only feature — and it doesn't,
  because the extension doesn't call it for anything today.

## Where to go next

- Working on the extension itself → `extension/README.md`
- Building out cloud sync → `backend/README.md` (has a real, working
  highlight-sync reference implementation, not just folder stubs — read the
  "What's implemented vs. stubbed" section before assuming anything else
  exists)

## Root-level scripts

```bash
npm install              # installs both workspaces
npm run extension:dev     # -> extension/
npm run extension:build
npm run backend:dev        # -> backend/
npm run backend:build
```

Each workspace also has its own `package.json` and can be worked on/deployed
with `cd extension` or `cd backend` directly, ignoring the root entirely if
you prefer.
