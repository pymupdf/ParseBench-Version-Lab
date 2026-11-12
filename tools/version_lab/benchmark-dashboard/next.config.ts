import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "huggingface.co",
        port: "",
        pathname: "/datasets/**/resolve/**",
        search: "",
      },
      ...[
        process.env.NEXT_PUBLIC_THUMBNAIL_BUCKET ?? "parsebench-thumbnails-457820",
        process.env.NEXT_PUBLIC_V2_THUMBNAIL_BUCKET ?? "parsebench-v2-thumbnails-457820",
      ].map((bucket) => ({
        protocol: "https" as const,
        hostname: "storage.googleapis.com",
        port: "",
        pathname: `/${bucket}/**`,
        search: "",
      })),
    ],
  },
};

export default nextConfig;
