import createMDX from "@next/mdx";
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
};

const withMDX = createMDX({
  extension: /\.mdx?$/,
});

export default withMDX({
  ...nextConfig,
  pageExtensions: ["ts", "tsx", "md", "mdx"],
});
