import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["postgres", "@node-rs/argon2"],
  experimental: {
    // Default is 1 MB, which a ~1 MB logo file would blow past once
    // multipart overhead and base64 are accounted for (uploadLogo in
    // src/app/app/shop/actions.ts caps the file itself at 1 MB).
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
