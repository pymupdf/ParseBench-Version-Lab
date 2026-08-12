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
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        port: "",
        pathname: "/parsebench-thumbnails-457820/**",
        search: "",
      },
    ],
  },
};

export default nextConfig;
