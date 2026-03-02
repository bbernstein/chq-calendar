import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});


export const metadata: Metadata = {
  title: "Chautauqua Calendar | 2026 Season",
  description: "Dynamic calendar for Chautauqua Institution 2026 season with real-time event updates, smart filtering, and export options.",
  keywords: "Chautauqua, calendar, events, 2026, institution, export, ics",
  authors: [{ name: "Chautauqua Calendar Team" }],
  icons: {
    icon: [
      { url: '/chq-calendar-icon-256.svg', type: 'image/svg+xml' },
      { url: '/chq-calendar-icon-256.svg', sizes: '256x256', type: 'image/svg+xml' }
    ],
    shortcut: '/chq-calendar-icon-256.svg',
    apple: '/chq-calendar-icon-256.svg',
  },
  openGraph: {
    title: "Chautauqua Calendar",
    description: "Discover and export Chautauqua Institution events with real-time updates",
    type: "website",
    url: "https://www.chqcal.org",
  },
  twitter: {
    card: "summary_large_image",
    title: "Chautauqua Calendar",
    description: "Dynamic calendar for Chautauqua Institution 2026 season",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href="/chq-calendar-icon-256.svg" />
        <link rel="shortcut icon" type="image/svg+xml" href="/chq-calendar-icon-256.svg" />
        {process.env.NODE_ENV === 'production' && (
          <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}` }} />
        )}
      </head>
      <body
        className={`${geistSans.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
