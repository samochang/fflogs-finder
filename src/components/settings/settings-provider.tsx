"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LANGS, type Lang, type Region, messages } from "@/lib/i18n.ts";

interface Settings {
  lang: Lang;
  region: Region;
  setLang: (lang: Lang) => void;
  setRegion: (region: Region) => void;
}

const SettingsContext = createContext<Settings | null>(null);

const LANG_KEY = "fflogs-finder:lang";
const REGION_KEY = "fflogs-finder:region";

/** <html lang> とテーマの初期化スクリプトで参照する。 */
export const LANG_INIT_SCRIPT = `(function(){try{var l=localStorage.getItem("${LANG_KEY}");if(l==="ja"||l==="en"){document.documentElement.lang=l;}}catch(e){}})();`;

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ja");
  const [region, setRegionState] = useState<Region>("JP");

  // 保存済みの設定を読み込む（初期描画の後に合わせる）
  useEffect(() => {
    try {
      const savedLang = window.localStorage.getItem(LANG_KEY);
      if (savedLang === "ja" || savedLang === "en") setLangState(savedLang);
      const savedRegion = window.localStorage.getItem(REGION_KEY);
      if (savedRegion === "JP" || savedRegion === "NA" || savedRegion === "EU") setRegionState(savedRegion);
    } catch {
      // localStorage が使えなくても既定値で動く
    }
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      // 保存できなくても表示は切り替わる
    }
  }, []);

  const setRegion = useCallback((next: Region) => {
    setRegionState(next);
    try {
      window.localStorage.setItem(REGION_KEY, next);
    } catch {
      // 同上
    }
  }, []);

  const value = useMemo<Settings>(() => ({ lang, region, setLang, setRegion }), [lang, region, setLang, setRegion]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/** 言語とリージョンの設定。Provider の外では既定値（ja / JP）を返す。 */
export function useSettings(): Settings {
  const context = useContext(SettingsContext);
  const fallback = useMemo<Settings>(
    () => ({ lang: "ja", region: "JP", setLang: () => {}, setRegion: () => {} }),
    [],
  );
  return context ?? fallback;
}

/** 文言。`const t = useMessages()` で `t.compare` のように使う。 */
export function useMessages() {
  return messages(useSettings().lang);
}

export { LANGS };
