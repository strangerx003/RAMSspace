import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAMspace",
  description: "RAMspace — Reliability, Availability, Maintainability & Safety Engineering Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
