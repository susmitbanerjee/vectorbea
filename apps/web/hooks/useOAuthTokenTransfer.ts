"use client";

import { useEffect } from "react";
import { setAccessToken } from "@/lib/api/client";

/**
 * After an OAuth redirect, the callback sets a short-lived readable cookie
 * `vb-token-transfer` (expires 60s, NOT httpOnly) containing our JWT.
 * This hook picks it up, moves it to localStorage for Kotlin API calls,
 * then deletes the cookie.
 */
export function useOAuthTokenTransfer() {
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)vb-token-transfer=([^;]+)/);
    if (!match?.[1]) return;
    const token = decodeURIComponent(match[1]);
    setAccessToken(token);
    // Clear the transfer cookie
    document.cookie = "vb-token-transfer=; max-age=0; path=/";
  }, []);
}
