import type { NextConfig } from "next";

const configuredTypeScriptProject = process.env.NEXT_TSCONFIG_PATH?.trim();

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  serverExternalPackages: ["@earendil-works/pi-ai", "@earendil-works/pi-agent-core"],
  ...(configuredTypeScriptProject
    ? { typescript: { tsconfigPath: configuredTypeScriptProject } }
    : {}),
};

export default nextConfig;
