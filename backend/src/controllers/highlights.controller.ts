import type { Response } from 'express';
import { Highlight } from '../models/Highlight.js';
import { upsertHighlightSchema } from '../validators/highlight.validator.js';
import type { AuthedRequest } from '../middleware/requireLicense.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * GET /api/highlights?since=<clientUpdatedAt>
 * Returns everything changed after `since` for this license, so a device
 * can pull incremental changes rather than the whole library every time.
 * Soft-deleted records ARE included (deletedAt set) so the client can
 * remove them locally too — see the extension's storage/db.ts soft-delete
 * comment for the matching half of this.
 */
export async function listHighlights(req: AuthedRequest, res: Response) {
  const since = Number(req.query.since ?? 0);
  const docs = await Highlight.find({
    licenseKeyHash: req.licenseKeyHash,
    clientUpdatedAt: { $gt: Number.isFinite(since) ? since : 0 },
  }).lean();
  res.json({ success: true, data: docs });
}

/**
 * POST /api/highlights
 * Upsert-by-clientId, last-write-wins on clientUpdatedAt. This is
 * deliberately simple (brief §37's "conflict resolution" in its fullest
 * form — e.g. field-level merges — is real future work, not something to
 * fake here); last-write-wins is an honest, documented starting point.
 */
export async function upsertHighlight(req: AuthedRequest, res: Response) {
  const parsed = upsertHighlightSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, `Invalid highlight payload: ${parsed.error.issues[0]?.message ?? 'validation failed'}`);
  }
  const input = parsed.data;

  const existing = await Highlight.findOne({
    licenseKeyHash: req.licenseKeyHash,
    clientId: input.clientId,
  });

  if (existing && existing.clientUpdatedAt >= input.clientUpdatedAt) {
    // The server already has an equal-or-newer version — tell the client
    // to take THIS version rather than overwrite it with a stale one.
    return res.json({ success: true, data: existing, conflict: true });
  }

  const doc = await Highlight.findOneAndUpdate(
    { licenseKeyHash: req.licenseKeyHash, clientId: input.clientId },
    { $set: { ...input, licenseKeyHash: req.licenseKeyHash } },
    { upsert: true, new: true }
  );

  res.json({ success: true, data: doc });
}

/** DELETE /api/highlights/:clientId — soft delete, mirrors the extension's own soft-delete semantics. */
export async function deleteHighlight(req: AuthedRequest, res: Response) {
  const doc = await Highlight.findOneAndUpdate(
    { licenseKeyHash: req.licenseKeyHash, clientId: req.params.clientId },
    { $set: { deletedAt: Date.now(), clientUpdatedAt: Date.now() } },
    { new: true }
  );
  if (!doc) throw new ApiError(404, 'Highlight not found.');
  res.json({ success: true, data: doc });
}
