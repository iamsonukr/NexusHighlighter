import type { Response } from 'express';
import { Highlight } from '../models/Highlight.js';
import { upsertHighlightSchema } from '../validators/highlight.validator.js';
import type { AuthedRequest } from '../middleware/requireLicense.js';
import { ApiError } from '../middleware/errorHandler.js';

function requireSyncOwner(req: AuthedRequest): string {
  if (!req.syncOwnerHash) throw new ApiError(401, 'Missing sync owner.');
  return req.syncOwnerHash;
}

async function migrateLegacyHighlights(req: AuthedRequest) {
  if (!req.syncOwnerHash || !req.legacyLicenseKeyHash) return;

  await Highlight.updateMany(
    {
      licenseKeyHash: req.legacyLicenseKeyHash,
      syncOwnerHash: { $exists: false },
    },
    { $set: { syncOwnerHash: req.syncOwnerHash } }
  );
}

/**
 * GET /api/highlights?since=<clientUpdatedAt>
 * Returns everything changed after `since` for this verified customer.
 */
export async function listHighlights(req: AuthedRequest, res: Response) {
  const syncOwnerHash = requireSyncOwner(req);
  await migrateLegacyHighlights(req);

  const since = Number(req.query.since ?? 0);
  const docs = await Highlight.find({
    syncOwnerHash,
    clientUpdatedAt: { $gt: Number.isFinite(since) ? since : 0 },
  }).lean();
  res.json({ success: true, data: docs });
}

/**
 * POST /api/highlights
 * Upsert-by-clientId, last-write-wins on clientUpdatedAt.
 */
export async function upsertHighlight(req: AuthedRequest, res: Response) {
  const syncOwnerHash = requireSyncOwner(req);
  await migrateLegacyHighlights(req);

  const parsed = upsertHighlightSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, `Invalid highlight payload: ${parsed.error.issues[0]?.message ?? 'validation failed'}`);
  }
  const input = parsed.data;

  const existing = await Highlight.findOne({
    syncOwnerHash,
    clientId: input.clientId,
  });

  if (existing && existing.clientUpdatedAt >= input.clientUpdatedAt) {
    return res.json({ success: true, data: existing, conflict: true });
  }

  const doc = await Highlight.findOneAndUpdate(
    { syncOwnerHash, clientId: input.clientId },
    { $set: { ...input, syncOwnerHash } },
    { upsert: true, new: true }
  );

  res.json({ success: true, data: doc });
}

/** DELETE /api/highlights/:clientId - soft delete. */
export async function deleteHighlight(req: AuthedRequest, res: Response) {
  const syncOwnerHash = requireSyncOwner(req);
  await migrateLegacyHighlights(req);

  const doc = await Highlight.findOneAndUpdate(
    { syncOwnerHash, clientId: req.params.clientId },
    { $set: { deletedAt: Date.now(), clientUpdatedAt: Date.now() } },
    { new: true }
  );
  if (!doc) throw new ApiError(404, 'Highlight not found.');
  res.json({ success: true, data: doc });
}
