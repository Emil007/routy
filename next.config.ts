import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/better-sqlite3/prebuilds/**/*.node", "./node_modules/better-sqlite3/build/Release/*.node"],
  },
};

export default nextConfig;
