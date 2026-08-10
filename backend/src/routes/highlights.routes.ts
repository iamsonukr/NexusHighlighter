import { Router } from 'express';
import { requireLicense } from '../middleware/requireLicense.js';
import { listHighlights, upsertHighlight, deleteHighlight } from '../controllers/highlights.controller.js';

export const highlightsRouter = Router();

highlightsRouter.use(requireLicense);
highlightsRouter.get('/', listHighlights);
highlightsRouter.post('/', upsertHighlight);
highlightsRouter.delete('/:clientId', deleteHighlight);
