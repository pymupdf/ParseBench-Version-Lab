import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "ParseBench Workflow Benchmark Observatory";
const description = "Find benchmark workflows by run, commit, branch, or configuration, then inspect scores and compare source documents with parsed output.";

export const metadata: Metadata = {
  metadataBase: new URL("https://parsebench-dashboard.vercel.app"),
  title,
  description,
  applicationName: "ParseBench",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "ParseBench",
    title,
    description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ParseBench workflow benchmark observatory" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
