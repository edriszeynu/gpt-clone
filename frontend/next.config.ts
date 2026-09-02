import type { NextConfig } from "next";

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND}/:path*`,
      },
    ];
  },
};

export default nextConfig;
