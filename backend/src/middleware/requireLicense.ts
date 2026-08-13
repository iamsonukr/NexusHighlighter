import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/env.js';
import { hashLegacyLicenseKey, hashSyncOwner } from '../utils/hashLicenseKey.js';
import { logger } from '../utils/logger.js';

export interface AuthedRequest extends Request {
  syncOwnerHash?: string;
  legacyLicenseKeyHash?: string;
}

type VerifyLicenseResponse = {
  success: boolean;
  hasAccess?: boolean;
  message?: string;
  user?: {
    id?: string;
  } | null;
};

/**
 * Cloud sync access is available to any registered identity the license server
 * can verify. Paid access can still gate other extension features, but sync
 * records are owned by the verified customer id.
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
    const data = (await verifyRes.json()) as VerifyLicenseResponse;

    if (!data.success) {
      logger.info('license_check_denied', { reason: data.message ?? 'no access' });
      return res.status(403).json({ success: false, message: data.message ?? 'Registration could not be verified.' });
    }

    if (!data.user?.id) {
      logger.error('license_check_missing_user_id', { message: 'verify response did not include user.id' });
      return res.status(502).json({ success: false, message: 'License server did not return a sync owner.' });
    }

    req.syncOwnerHash = hashSyncOwner(data.user.id);
    req.legacyLicenseKeyHash = hashLegacyLicenseKey(licenseKey);
    next();
  } catch (err) {
    logger.error('license_check_failed', { message: err instanceof Error ? err.message : 'unknown' });
    return res.status(502).json({ success: false, message: 'Could not verify license right now.' });
  }
}
