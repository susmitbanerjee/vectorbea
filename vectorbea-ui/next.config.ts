import createMDX from "@next/mdx";
import remarkGfm from "remark-gfm";
import type { NextConfig } from "next";

const docsPortalUrl =
  process.env.DOCS_PORTAL_URL?.replace(/\/+$/, "") || "https://docs.vectorbea.com";

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
  async redirects() {
    return [
      {
        source: "/docs",
        destination: docsPortalUrl,
        permanent: false,
      },
      {
        source: "/docs/:path*",
        destination: docsPortalUrl,
        permanent: false,
      },
    ];
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
