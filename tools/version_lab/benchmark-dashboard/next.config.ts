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
    ],
  },
};

export default nextConfig;
