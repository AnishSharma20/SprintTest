import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The guided generator (born as /generator-v2) replaced the original at /generator on
      // 2026-08-09; keep old links and bookmarks working.
      { source: "/generator-v2", destination: "/generator", permanent: true },
    ];
  },
};

export default nextConfig;
