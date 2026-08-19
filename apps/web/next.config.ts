// build: premium-builder-icons-agent-brain
import createMDX from "@next/mdx";
import remarkGfm from "remark-gfm";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  output: "standalone",
  images: {
    remotePatterns: [
      // GitHub avatars
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      // Google avatars
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  /**
   * Password-era URLs.
   *
   * Sign-in is federated now, so none of these have a destination any more. They
   * are permanent redirects rather than deletions because they are already out
   * in the world — in old verification mails, in bookmarks, and in whatever a
   * password manager saved as the reset page. A 404 there reads as "the product
   * is broken"; landing on sign-in reads as "this moved", which is what
   * happened.
   *
   * The credential POST handlers are NOT redirected. They are deleted, so they
   * 404 — a redirect would answer a credential submission with a 200-shaped
   * flow and imply the endpoint still means something.
   */
  async redirects() {
    return [
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/auth/forgot-password",
      "/auth/reset-password",
      "/auth/verify-email",
      "/api/auth/verify-email",
    ].map((source) => ({ source, destination: "/signin", permanent: true }));
  },
};

const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [remarkGfm],
  },
});

export default withMDX({
  ...nextConfig,
  pageExtensions: ["ts", "tsx", "md", "mdx"],
});
