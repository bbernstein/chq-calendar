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

export const metadata: Metadata = {
  title: "Chautauqua Calendar Generator | 2025 Season",
  description: "Dynamic calendar generator for Chautauqua Institution 2025 season with real-time event updates, smart filtering, and export options.",
  keywords: "Chautauqua, calendar, events, 2025, institution, generator, export, ics",
  authors: [{ name: "Chautauqua Calendar Team" }],
  openGraph: {
    title: "Chautauqua Calendar Generator",
    description: "Discover and export Chautauqua Institution events with real-time updates",
    type: "website",
    url: "https://www.chqcal.org",
  },
  twitter: {
    card: "summary_large_image",
    title: "Chautauqua Calendar Generator",
    description: "Dynamic calendar for Chautauqua Institution 2025 season",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
