import { z } from 'zod';

const anchorSchema = z.object({
  selectedText: z.string().min(1).max(5000),
  prefixText: z.string().max(200).default(''),
  suffixText: z.string().max(200).default(''),
  paragraphText: z.string().max(4000).default(''),
  selector: z.string().max(500).default(''),
  startOffset: z.number().int().nonnegative().default(0),
  endOffset: z.number().int().nonnegative().default(0),
});

export const upsertHighlightSchema = z.object({
  clientId: z.string().min(1).max(100),
  pageId: z.string().min(1).max(100),
  url: z.string().url().max(2000),
  canonicalUrl: z.string().url().max(2000),
  domain: z.string().min(1).max(255),
  pageTitle: z.string().max(500).default(''),
  anchor: anchorSchema,
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'orange', 'purple']),
  note: z.string().max(10_000).nullable().default(null),
  tags: z.array(z.string().max(50)).max(50).default([]),
  isPinned: z.boolean().default(false),
  isArchived: z.boolean().default(false),
  clientCreatedAt: z.number(),
  clientUpdatedAt: z.number(),
  deletedAt: z.number().nullable().default(null),
});

export type UpsertHighlightInput = z.infer<typeof upsertHighlightSchema>;
