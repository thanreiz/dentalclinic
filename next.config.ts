import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets parallel dev servers in one checkout use separate build dirs (e.g. NEXT_DIST_DIR=.next-api).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
