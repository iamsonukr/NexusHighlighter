import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/env.js';
import { hashLicenseKey } from '../utils/hashLicenseKey.js';
import { logger } from '../utils/logger.js';

export interface AuthedRequest extends Request {
  licenseKeyHash?: string;
}

/**
 * Cloud sync is a Pro feature, so every sync route re-checks the license
 * against the SAME external verify endpoint the extension itself calls
 * (see backend/.env.example — this is a separate, already-live service,
 * not something this backend owns). This backend never trusts a client's
 * bare assertion that it's "Pro" — the whole point of doing this
 * server-side is that a client can't just claim access.
 *
 * On success, req.licenseKeyHash is set for the route handler to scope
 * queries by. The raw key itself is discarded after this middleware runs;
 * it is never logged (see logger.ts) or persisted (see hashLicenseKey.ts).
 */
export async function requireLicense(req: AuthedRequest, res: Response, next: NextFunction) {
  const licenseKey = req.header('x-license-key');
  if (!licenseKey) {
    return res.status(401).json({ success: false, message: 'Missing license key.' });
  }

  try {
    const verifyRes = await fetch(config.licenseVerifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: config.licenseProductId, licenseKey }),
    });
    const data = (await verifyRes.json()) as { success: boolean; hasAccess?: boolean; message?: string };

    if (!data.success || !data.hasAccess) {
      logger.info('license_check_denied', { reason: data.message ?? 'no access' });
      return res.status(403).json({ success: false, message: data.message ?? 'License is not active.' });
    }

    req.licenseKeyHash = hashLicenseKey(licenseKey);
    next();
  } catch (err) {
    logger.error('license_check_failed', { message: err instanceof Error ? err.message : 'unknown' });
    return res.status(502).json({ success: false, message: 'Could not verify license right now.' });
  }
}
