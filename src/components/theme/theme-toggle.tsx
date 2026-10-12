"use client";

import { useEffect, useState } from "react";
import { useMessages } from "../settings/settings-provider.tsx";

type Mode = "light" | "dark";

const STORAGE_KEY = "fflogs-finder:theme";

/** <html> の dark クラスを切り替える。初期値は layout.tsx の inline script が設定する。 */
export function ThemeToggle() {
  const t = useMessages();
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    setMode(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next: Mode = mode === "dark" ? "light" : "dark";
    setMode(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage が使えない環境でも表示だけは切り替える
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mode === "dark" ? t.themeLight : t.themeDark}
      title={mode === "dark" ? t.themeLight : t.themeDark}
      className="rounded-md border border-line-strong px-2 py-1 text-xs text-ink-muted transition-colors hover:border-accent hover:text-accent"
    >
      {mode === "dark" ? "☀" : "☾"}
    </button>
  );
}

/** 画面描画前にテーマを決めて、ちらつきを防ぐ。 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem("${STORAGE_KEY}");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;
