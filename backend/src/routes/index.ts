import { Router } from 'express';
import { highlightsRouter } from './highlights.routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => res.json({ success: true, message: 'ok' }));
apiRouter.use('/highlights', highlightsRouter);

// Pages/notes/tags/collections/bookmarks/search endpoints from the original
// brief (§27) are NOT implemented yet — highlights sync is the one thing
// this scaffold actually does end-to-end, so it's a real reference for the
// pattern (license-scoped, last-write-wins) rather than a pile of stubs.
