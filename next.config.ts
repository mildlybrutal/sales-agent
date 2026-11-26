import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loads ONNX models and voice files from its own package directory at runtime.
  serverExternalPackages: ["kokoro-js"],
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
