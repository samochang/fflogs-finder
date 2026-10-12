import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { LANG_INIT_SCRIPT, SettingsProvider } from "@/components/settings/settings-provider.tsx";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme-toggle.tsx";
import "./globals.css";

const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-jp",
  display: "swap",
});

export const metadata: Metadata = {
  title: "固定募集スカウター",
  description:
    "FF14 の固定募集文から最大 8 人を抽出し、直近 6 つの零式の FFLogs 成績を横並びで比較する。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={notoSansJp.variable} suppressHydrationWarning>
      <head>
        {/* 描画前にテーマと言語を決めてちらつきを防ぐ */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LANG_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
