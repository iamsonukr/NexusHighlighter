import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, message: 'Not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  // Never log request bodies here — they may contain highlight/note text.
  logger.error('unhandled_error', { message });
  res.status(500).json({ success: false, message: 'Something went wrong.' });
}
