import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * The external license server verifies the key and returns the customer
 * user.id. Synced records are scoped by a hash of that stable id so renewals
 * and replacement keys keep seeing the same highlight library.
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
    clientId: { type: String, required: true },
    syncOwnerHash: { type: String, required: true, index: true },
    licenseKeyHash: { type: String, default: null, index: true },

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

    clientCreatedAt: { type: Number, required: true },
    clientUpdatedAt: { type: Number, required: true },
    deletedAt: { type: Number, default: null },
  },
  { timestamps: true }
);

HighlightSchema.index({ syncOwnerHash: 1, clientId: 1 }, { unique: true });
HighlightSchema.index({ syncOwnerHash: 1, pageId: 1 });

export type HighlightDoc = InferSchemaType<typeof HighlightSchema>;
export const Highlight = model('Highlight', HighlightSchema);
