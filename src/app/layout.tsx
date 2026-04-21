import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppThemeProvider } from "@/components/app-theme-provider";
import { SessionProvider } from "@/components/session-provider";
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
  title: "ScriptureLM",
  description: "Theological research workspace — shared catalog, RAG chat, grounded summaries.",
  icons: {
    icon: [
      {
        url: "/scripturelm-logo-fire-subtle.png",
        type: "image/png",
      },
    ],
    apple: "/scripturelm-logo-fire-subtle.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <AppThemeProvider>
          <SessionProvider>{children}</SessionProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
