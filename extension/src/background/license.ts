import type { LicenseState, VerifyLicenseResponse } from '@/types';
import { EMPTY_LICENSE_STATE } from '@/types';
import { getLicenseState, saveLicenseState } from '@/storage/db';

/**
 * Licensing model (per product owner's requirement):
 *   - No login, no signup, no in-extension payment.
 *   - Exactly one input: a license key, entered once in the popup.
 *   - That key is checked against the customer's own backend. All purchase
 *     flows happen on their website, entirely outside the extension.
 *   - Re-verified automatically on every browser start (chrome.runtime.onStartup
 *     in src/background/index.ts) and once right after install.
 */

export const VERIFY_URL = 'https://nexusbackend-ookk.onrender.com/api/subscriptions/verify';
export const PRODUCT_ID = '6a7ae899e65a8aa481d69388';

const VERIFY_TIMEOUT_MS = 15_000;

async function callVerifyEndpoint(licenseKey: string): Promise<VerifyLicenseResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: PRODUCT_ID, licenseKey }),
      signal: controller.signal,
    });
    const data = (await res.json()) as VerifyLicenseResponse;
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Verifies a freshly-entered key (called from the popup when the user
 * submits the license box). Always hits the network and always overwrites
 * the stored state, whatever the result.
 */
export async function activateLicense(key: string): Promise<LicenseState> {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    const state: LicenseState = {
      ...EMPTY_LICENSE_STATE,
      status: 'invalid',
      message: 'Enter a license key.',
    };
    await saveLicenseState(state);
    return state;
  }

  let response: VerifyLicenseResponse;
  try {
    response = await callVerifyEndpoint(trimmedKey);
  } catch {
    const state: LicenseState = {
      ...EMPTY_LICENSE_STATE,
      key: trimmedKey,
      status: 'offline',
      message: "Couldn't reach the license server. Check your connection and try again.",
    };
    await saveLicenseState(state);
    return state;
  }

  const state = responseToState(trimmedKey, response);
  await saveLicenseState(state);
  return state;
}

/**
 * Silent re-check of whatever key is already stored. Used on every browser
 * start. If the key was never set, this is a no-op. If the network call
 * fails (offline), the previously granted access is preserved for this
 * session rather than immediately locking the user out — but status is
 * marked 'offline' so the UI can be honest about it, and a hard failure
 * response from the server (invalid/expired) always wins over a stale cache.
 */
export async function reverifyStoredLicense(): Promise<LicenseState> {
  const current = await getLicenseState();
  if (!current.key) return current;

  let response: VerifyLicenseResponse;
  try {
    response = await callVerifyEndpoint(current.key);
  } catch {
    const offlineState: LicenseState = {
      ...current,
      status: 'offline',
      message: 'Offline — showing last known license status.',
    };
    await saveLicenseState(offlineState);
    return offlineState;
  }

  const state = responseToState(current.key, response);
  await saveLicenseState(state);
  return state;
}

export function responseToState(key: string, response: VerifyLicenseResponse): LicenseState {
  if (!response.success) {
    return {
      ...EMPTY_LICENSE_STATE,
      key,
      status: 'invalid',
      message: response.message || 'This license key is not valid.',
      lastVerifiedAt: Date.now(),
    };
  }

  const planType = response.plan?.type ? String(response.plan.type).toLowerCase() : null;
  const hasPaidAccess = response.hasAccess && planType !== 'free';

  return {
    key,
    status: 'valid',
    hasAccess: hasPaidAccess,
    message: response.message,
    userId: response.user?.id ?? null,
    userFullName: response.user?.fullName ?? null,
    planName: response.plan?.name ?? null,
    expiresAt: response.license?.expiresAt ?? response.subscription?.endDate ?? null,
    lastVerifiedAt: Date.now(),
  };
}
