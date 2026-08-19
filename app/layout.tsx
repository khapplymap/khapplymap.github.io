import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "高雄市施工進度追蹤圖",
  description: "點選高雄市行政區，查看本案各區載具施工進度與學校名單。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body className="antialiased">{children}</body>
    </html>
  );
}
