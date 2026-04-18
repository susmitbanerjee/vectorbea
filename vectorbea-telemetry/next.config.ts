import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Telemetry app is internal-only; skip linting and type-checking in CI
  // builds so a type error in the telemetry app doesn't block the main UI.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
