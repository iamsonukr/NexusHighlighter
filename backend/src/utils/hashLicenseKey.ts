import { createHash } from 'node:crypto';

/**
 * Lookup hashes keep sync records scoped without storing raw license keys or
 * external user IDs. These are not password hashes; they are deterministic
 * database lookup keys.
 */
export function hashLookupKey(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

export function hashLicenseKey(licenseKey: string): string {
  return hashLookupKey(`license:${licenseKey}`);
}

export function hashLegacyLicenseKey(licenseKey: string): string {
  return hashLookupKey(licenseKey);
}

export function hashSyncOwner(ownerId: string): string {
  return hashLookupKey(`user:${ownerId}`);
}
