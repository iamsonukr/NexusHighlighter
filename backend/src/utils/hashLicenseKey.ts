import { createHash } from 'node:crypto';

/**
 * Storing the raw license key in this backend's own database would mean a
 * dump of THIS database hands out working keys for the (separate) license
 * server. Hashing it means this backend can still scope/query records
 * consistently per key without ever persisting the key itself.
 *
 * This is a lookup key, not a password store — a fast hash (SHA-256) is
 * appropriate here, unlike bcrypt/argon2 which would be the right call if
 * this backend ever grows real user passwords.
 */
export function hashLicenseKey(licenseKey: string): string {
  return createHash('sha256').update(licenseKey.trim()).digest('hex');
}
