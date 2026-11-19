import type { Metadata, Viewport } from "next";
import { AppNav } from "@/frontend/components/AppNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Empire HQ",
  description: "Private multi-business AI headquarters.",
  // Private application: never index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#020617",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <AppNav />
        {children}
      </body>
    </html>
  );
}
