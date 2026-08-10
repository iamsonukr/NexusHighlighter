import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * There is no user-accounts system (see the extension's README — no login,
 * no signup). Instead every synced record is scoped by the license key that
 * created it, the same key the extension already verifies with the license
 * server. `licenseKeyHash` (not the raw key) is what's actually stored and
 * queried on, so a database dump alone doesn't hand out working keys — see
 * utils/hashLicenseKey.ts.
 */
const AnchorSchema = new Schema(
  {
    selectedText: { type: String, required: true },
    prefixText: { type: String, default: '' },
    suffixText: { type: String, default: '' },
    paragraphText: { type: String, default: '' },
    selector: { type: String, default: '' },
    startOffset: { type: Number, default: 0 },
    endOffset: { type: Number, default: 0 },
  },
  { _id: false }
);

const HighlightSchema = new Schema(
  {
    clientId: { type: String, required: true }, // id generated on-device (src/utils/url.ts uid())
    licenseKeyHash: { type: String, required: true, index: true },

    pageId: { type: String, required: true, index: true },
    url: { type: String, required: true },
    canonicalUrl: { type: String, required: true },
    domain: { type: String, required: true, index: true },
    pageTitle: { type: String, default: '' },

    anchor: { type: AnchorSchema, required: true },
    color: { type: String, required: true },

    note: { type: String, default: null },
    tags: { type: [String], default: [] },

    isPinned: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },

    // Client-supplied timestamps drive last-write-wins conflict resolution
    // (brief §37) — they are NOT the same as Mongoose's own timestamps below,
    // which track when this server last saw the record.
    clientCreatedAt: { type: Number, required: true },
    clientUpdatedAt: { type: Number, required: true },
    deletedAt: { type: Number, default: null }, // soft delete, so deletions can propagate to other devices
  },
  { timestamps: true }
);

HighlightSchema.index({ licenseKeyHash: 1, clientId: 1 }, { unique: true });
HighlightSchema.index({ licenseKeyHash: 1, pageId: 1 });

export type HighlightDoc = InferSchemaType<typeof HighlightSchema>;
export const Highlight = model('Highlight', HighlightSchema);
