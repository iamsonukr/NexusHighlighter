import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 5000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongodbUri: required('MONGODB_URI'),
  clientUrl: process.env.CLIENT_URL ?? '*',
  // The license verification service is a separate, already-live product
  // (see .env.example) — its URL/productId are constants, not secrets, and
  // are duplicated here (matching the extension's src/background/license.ts)
  // only so this backend can independently confirm a license before
  // accepting a sync write. They are NOT this backend's own auth system.
  licenseVerifyUrl: 'https://nexusbackend-ookk.onrender.com/api/subscriptions/verify',
  licenseProductId: '6a7567937e01aee3cd38bb15',
} as const;
