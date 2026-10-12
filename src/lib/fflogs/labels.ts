/**
 * 表示用ラベル。
 *
 * FFLogs は zone / expansion を英語名で返すため、日本語圏向けの短い表示名を当てる。
 * 新しい零式 Tier が追加された場合はここに 1 行足すだけでよい（未知のものは FFLogs 名でフォールバック）。
 */

/** 拡張の日本語表記。 */
export const EXPANSION_LABELS_JA: Readonly<Record<string, string>> = {
  Dawntrail: "黄金のレガシー",
  Endwalker: "暁月のフィナーレ",
  Shadowbringers: "漆黒のヴィランズ",
  Stormblood: "紅蓮のリベレーター",
  Heavensward: "蒼天のイシュガルド",
  "A Realm Reborn": "新生エオルゼア",
};

/**
 * 零式 Tier の日本語名（zoneID -> 表示名）。
 *
 * **FFLogs は英語名しか返さない**（`Zone.name` は "Anabaseios" などで、
 * Accept-Language を付けても変わらない）。そのため日本語名はここで持つ。
 * 新しい零式が追加されたら 1 行足す（未知の zone は FFLogs の英語名で表示される）。
 *
 * 表のヘッダは幅が限られるので短縮名、正式名称は `ZONE_FULL_NAMES_JA` に入れて
 * ツールチップで見せる。
 */
export const ZONE_LABELS_JA: Readonly<Record<number, string>> = {
  // 漆黒のヴィランズ：希望の園エデン零式
  29: "覚醒編",
  33: "共鳴編",
  38: "再生編",
  // 暁月のフィナーレ：万魔殿パンデモニウム零式
  44: "辺獄編",
  49: "煉獄編",
  54: "天獄編",
  // 黄金のレガシー：至天の座アルカディア零式
  62: "ライトヘビー級",
  68: "クルーザー級",
  73: "ヘビー級",
};

/** 零式 Tier の正式名称（ツールチップ用）。 */
export const ZONE_FULL_NAMES_JA: Readonly<Record<number, string>> = {
  29: "希望の園エデン零式：覚醒編",
  33: "希望の園エデン零式：共鳴編",
  38: "希望の園エデン零式：再生編",
  44: "万魔殿パンデモニウム零式：辺獄編",
  49: "万魔殿パンデモニウム零式：煉獄編",
  54: "万魔殿パンデモニウム零式：天獄編",
  62: "至天の座アルカディア零式：ライトヘビー級",
  68: "至天の座アルカディア零式：クルーザー級",
  73: "至天の座アルカディア零式：ヘビー級",
};

/**
 * 拡張ごとの配色。
 * 拡張ロゴに寄せた色（mock.png から暁月・漆黒の値を実測）。
 */
export interface ExpansionColor {
  /** 見出しの背景 */
  bg: string;
  /** 上端のアクセント線と文字色 */
  accent: string;
}

export const EXPANSION_COLORS: Readonly<Record<string, ExpansionColor>> = {
  Dawntrail: { bg: "#faf5e6", accent: "#a8892c" },
  Endwalker: { bg: "#f9f7f3", accent: "#8c7f5c" },
  Shadowbringers: { bg: "#eef2f8", accent: "#3f5b8f" },
  Stormblood: { bg: "#fbf0ef", accent: "#a8392f" },
  Heavensward: { bg: "#f0f5fb", accent: "#3f6f9f" },
  "A Realm Reborn": { bg: "#f2f4f6", accent: "#5b6b7c" },
};

const FALLBACK_EXPANSION_COLOR: ExpansionColor = { bg: "#eef4fd", accent: "#2563eb" };

export function expansionColor(name: string): ExpansionColor {
  return EXPANSION_COLORS[name] ?? FALLBACK_EXPANSION_COLOR;
}

export function expansionLabel(name: string): string {
  const ja = EXPANSION_LABELS_JA[name];
  return ja ? `${ja} ${name.toUpperCase()}` : name;
}

export function zoneLabel(zoneId: number, fallbackName: string): string {
  return ZONE_LABELS_JA[zoneId] ?? fallbackName;
}

/** 正式名称（未知の zone は FFLogs の英語名）。ツールチップ用。 */
export function zoneFullName(zoneId: number, fallbackName: string): string {
  return ZONE_FULL_NAMES_JA[zoneId] ?? fallbackName;
}
