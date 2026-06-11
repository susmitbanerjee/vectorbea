/**
 * SSRF Protection — Server-side only
 *
 * Blocks requests to private/internal networks, metadata endpoints,
 * and other dangerous targets when performing outbound connection tests
 * or HTTP tool calls from the Vectorbea Cloud runtime.
 *
 * Private Runner mode bypasses these checks (enforced separately).
 */

import { lookup } from "dns/promises";

// ─── Private/reserved IP ranges ───────────────────────────────────────────────

const PRIVATE_RANGES: [number, number, number][] = [
  // Loopback
  [0x7f000000, 0xffffff00, 24], // 127.0.0.0/8 → simplified as /24 ranges below
  // Link-local
  [0xa9fe0000, 0xffff0000, 16], // 169.254.0.0/16
  // Private
  [0x0a000000, 0xff000000, 8],  // 10.0.0.0/8
  [0xac100000, 0xfff00000, 12], // 172.16.0.0/12
  [0xc0a80000, 0xffff0000, 16], // 192.168.0.0/16
  // Reserved
  [0xc0000000, 0xffffff00, 24], // 192.0.0.0/24
  [0xc0000200, 0xffffff00, 24], // 192.0.2.0/24 (TEST-NET-1)
  [0xc6336400, 0xffffff00, 24], // 198.51.100.0/24 (TEST-NET-2)
  [0xcb007100, 0xffffff00, 24], // 203.0.113.0/24 (TEST-NET-3)
  [0xe0000000, 0xf0000000, 4],  // 224.0.0.0/4 (Multicast)
  [0xf0000000, 0xf0000000, 4],  // 240.0.0.0/4 (Reserved)
  // AWS Metadata
  [0xa9fe0000, 0xffff0000, 16], // 169.254.0.0/16 (already covered)
];

// Dangerous hostnames
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
  "instance-data",
]);

// Dangerous hostname suffixes
const BLOCKED_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".corp",
  ".intra",
];

function ipToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error("Not an IPv4 address: " + ip);
  return (
    (parseInt(parts[0]!, 10) << 24 |
     parseInt(parts[1]!, 10) << 16 |
     parseInt(parts[2]!, 10) << 8  |
     parseInt(parts[3]!, 10)) >>> 0
  );
}

function isPrivateIP(ip: string): boolean {
  // IPv6 loopback
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  // IPv6 link-local
  if (ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;

  let int: number;
  try {
    int = ipToInt(ip);
  } catch {
    return false; // IPv6 or invalid — can't check
  }

  // Check loopback separately (127.0.0.0/8)
  if ((int >>> 24) === 127) return true;

  for (const [network, mask] of PRIVATE_RANGES) {
    if ((int & mask) === (network & mask)) return true;
  }
  return false;
}

export interface SSRFCheckResult {
  allowed: boolean;
  reason?: string;
  resolvedIP?: string;
}

/**
 * Check a URL for SSRF risks.
 * Resolves DNS and validates the resulting IP is not private/reserved.
 *
 * @param url - The URL to check
 * @param privateRunnerMode - If true, skip SSRF checks (private runner handles routing)
 */
export async function checkSSRF(
  url: string,
  privateRunnerMode = false,
): Promise<SSRFCheckResult> {
  if (privateRunnerMode) {
    return { allowed: true };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "INVALID_URL: URL is malformed." };
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      allowed: false,
      reason: `UNSUPPORTED_SCHEME: Protocol '${parsed.protocol}' is not allowed. Use http or https.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known dangerous hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return {
      allowed: false,
      reason: `PRIVATE_NETWORK_UNREACHABLE: Hostname '${hostname}' is a private/internal address. Use a private runner for private networks.`,
    };
  }

  // Block dangerous suffixes
  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return {
        allowed: false,
        reason: `PRIVATE_NETWORK_UNREACHABLE: Hostname '${hostname}' appears to be an internal address (suffix: ${suffix}). Use a private runner.`,
      };
    }
  }

  // If it's already an IP, check it directly
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isPrivateIP(hostname)) {
      return {
        allowed: false,
        reason: `PRIVATE_NETWORK_UNREACHABLE: IP ${hostname} is in a private or reserved range. Use a private runner.`,
        resolvedIP: hostname,
      };
    }
    return { allowed: true, resolvedIP: hostname };
  }

  // DNS resolution — check resolved IPs
  try {
    const resolved = await lookup(hostname, { all: true });
    for (const { address } of resolved) {
      if (isPrivateIP(address)) {
        return {
          allowed: false,
          reason: `PRIVATE_NETWORK_UNREACHABLE: '${hostname}' resolves to private IP ${address}. Use a private runner for internal systems.`,
          resolvedIP: address,
        };
      }
    }
    return { allowed: true, resolvedIP: resolved[0]?.address };
  } catch (e) {
    return {
      allowed: false,
      reason: `DNS_FAILED: Could not resolve '${hostname}'. Check the hostname or network configuration.`,
    };
  }
}

/**
 * Quick hostname-only check (no DNS resolution).
 * Use when you only have a hostname, not a full URL.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().trim();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  for (const suffix of BLOCKED_SUFFIXES) {
    if (h.endsWith(suffix)) return true;
  }
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
    return isPrivateIP(h);
  }
  return false;
}
