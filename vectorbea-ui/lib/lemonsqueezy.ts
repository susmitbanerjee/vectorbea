import "server-only";

import { createCheckout, lemonSqueezySetup } from "@lemonsqueezy/lemonsqueezy.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let initialized = false;

export function getLemonSqueezyConfig() {
  return {
    apiKey: requireEnv("LEMON_SQUEEZY_API_KEY"),
    storeId: Number.parseInt(requireEnv("LEMON_SQUEEZY_STORE_ID"), 10),
    variantId: Number.parseInt(requireEnv("LEMON_SQUEEZY_VARIANT_ID"), 10),
    webhookSecret: requireEnv("LEMON_SQUEEZY_WEBHOOK_SECRET"),
  };
}

export function getLemonSqueezyClient() {
  const { apiKey, storeId, variantId } = getLemonSqueezyConfig();

  if (!initialized) {
    lemonSqueezySetup({ apiKey });
    initialized = true;
  }

  return {
    createCheckout,
    storeId,
    variantId,
  };
}
