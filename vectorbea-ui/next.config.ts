import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  output: "standalone",
};

const withMDX = createMDX({
  extension: /\.mdx?$/,
});

export default withMDX({
  ...nextConfig,
  pageExtensions: ["ts", "tsx", "md", "mdx"],
});
