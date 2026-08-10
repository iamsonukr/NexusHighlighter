import { Schema, model, type InferSchemaType } from 'mongoose';

const PageSchema = new Schema(
  {
    clientId: { type: String, required: true }, // pageIdFor(canonicalUrl) from the extension
    licenseKeyHash: { type: String, required: true, index: true },

    url: { type: String, required: true },
    canonicalUrl: { type: String, required: true },
    domain: { type: String, required: true, index: true },
    title: { type: String, default: '' },
    description: { type: String, default: null },
    favicon: { type: String, default: null },

    readingStatus: {
      type: String,
      enum: ['unread', 'reading', 'completed', 'archived'],
      default: 'reading',
    },

    clientLastVisitedAt: { type: Number, required: true },
    clientCreatedAt: { type: Number, required: true },
    clientUpdatedAt: { type: Number, required: true },
  },
  { timestamps: true }
);

PageSchema.index({ licenseKeyHash: 1, clientId: 1 }, { unique: true });

export type PageDoc = InferSchemaType<typeof PageSchema>;
export const Page = model('Page', PageSchema);
