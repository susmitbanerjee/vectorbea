import "server-only";

import { after } from "next/server";

/**
 * Run work after the response is sent, and keep the function alive for it.
 *
 * A bare `void promise` after returning is cut off when a serverless function
 * freezes — on Vercel the notification or forward simply never happens. `after`
 * is the platform's way to finish it. Outside a request scope (unit tests,
 * scripts) `after` throws, and the task runs immediately instead.
 */
export function afterResponse(task: () => Promise<unknown>): void {
  try {
    after(async () => { await task().catch(() => undefined); });
  } catch {
    void task().catch(() => undefined);
  }
}
