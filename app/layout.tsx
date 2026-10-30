import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SwasthSync — Care, a little earlier",
  description:
    "An explainable early-warning workspace for thoughtful senior care. A synthetic-data demonstration with human-guided care priorities.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
