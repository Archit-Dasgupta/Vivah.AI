import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vivaah AI",
  description: "Your Minimal Indian Modern Wedding Assistant",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased bg-[var(--cream-bg)] text-[var(--text-maroon)]`}
      >
        <div className="relative min-h-screen">
          {/* Subtle lotus icon in top corner (optional, can remove) */}
          <div className="pointer-events-none select-none opacity-[0.06] fixed top-4 right-4 w-28 h-28 bg-[url('/lotus-soft.png')] bg-contain bg-no-repeat" />
          {children}
        </div>
      </body>
    </html>
  );
}
