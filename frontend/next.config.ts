import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable static export when authentication is enabled (NextAuth requires server-side functionality)
  // For production deployment, we'll need to deploy to a serverless platform or move auth to Lambda
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;