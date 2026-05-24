import "server-only";
import { NextResponse } from "next/server";

export async function GET() {
  const raw = process.env.VECTORBEA_OUTBOUND_IPS ?? "";
  const ips = raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (ips.length === 0) {
    return NextResponse.json({
      configured: false,
      ips: [],
      message: "Outbound IPs are not configured for this deployment. Set VECTORBEA_OUTBOUND_IPS in your environment.",
    });
  }

  return NextResponse.json({
    configured: true,
    ips,
    message: `Allowlist these IPs in your firewall or database security group to allow Vectorbea Cloud to connect.`,
  });
}
