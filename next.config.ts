import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The guided generator (born as /generator-v2) replaced the original at /generator on
      // 2026-08-09; keep old links and bookmarks working.
      { source: "/generator-v2", destination: "/generator", permanent: true },
      // The V2 redesigns replaced the originals at /, /claims and /about on 2026-08-12; keep
      // old links and bookmarks working.
      { source: "/studies-v2", destination: "/", permanent: true },
      { source: "/findings-v2", destination: "/claims", permanent: true },
      { source: "/about-v2", destination: "/about", permanent: true },
    ];
  },
};

export default nextConfig;
