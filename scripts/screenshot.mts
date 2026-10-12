/**
 * UI の見た目を確認するためのスクリーンショット取得。
 *
 *   node scripts/screenshot.mts [出力パス]
 *
 * API をスタブするので FFLogs の points を消費しない。
 * 事前に `npm run dev` で開発サーバを起動しておくこと。
 *
 * Playwright のブラウザは環境にキャッシュ済みのものを使う（playwright-core が必要）。
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import type { ApiRow } from "../src/lib/api/dto.ts";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://127.0.0.1:3000";
const OUT = process.argv[2] ?? "scripts/_ui-compare.png";

/** mock.png と同じ構成の 6 Tier（暁月のフィナーレ 3 + 漆黒のヴィランズ 3）。 */
const TIERS = [
  { zoneId: 54, name: "Anabaseios", expansion: "Endwalker", partitionName: "Standard (6.5)", floors: floors(4) },
  { zoneId: 49, name: "Abyssos", expansion: "Endwalker", partitionName: "Standard (6.3)", floors: floors(4) },
  { zoneId: 44, name: "Asphodelos", expansion: "Endwalker", partitionName: "Standard (6.1)", floors: floors(4) },
  { zoneId: 38, name: "Eden's Promise", expansion: "Shadowbringers", partitionName: "Standard", floors: floors(4) },
  { zoneId: 33, name: "Eden's Verse", expansion: "Shadowbringers", partitionName: "Standard", floors: floors(4) },
  { zoneId: 29, name: "Eden's Gate", expansion: "Shadowbringers", partitionName: "Standard", floors: floors(4) },
];

function floors(n: number) {
  return Array.from({ length: n }, (_, i) => ({ index: i + 1, label: `P${i + 1}`, encounterNames: [`Boss ${i + 1}`] }));
}

const ROSTER = [
  { position: "MT", job: "gunbreaker", name: "Rion Aster", world: "Chocobo", values: [98, 96, 99, 97, 97, 95, 98, 96, 94, 96, 93, 95, 91, 94, 92, 96, 89, 92, 90, 94, 86, 90, 88, 92] },
  { position: "ST", job: "darkKnight", name: "Kai Vesper", world: "Chocobo", values: [82, 78, 85, 88, 80, 82, 86, 84, 76, 79, 83, 81, 74, 77, 80, 78, 70, 73, 76, 75, 68, 71, 74, 72] },
  { position: "H1", job: "whiteMage", name: "Yuna Bloom", world: "Tonberry", values: [95, 93, 96, 94, 97, 95, 98, 96, 92, 94, 96, 93, 90, 92, 94, 91, 88, 90, 92, 89, 85, 87, 90, 88] },
  { position: "H2", job: "scholar", name: "Sena Lune", world: "Carbuncle", values: [68, 72, 75, 70, 78, 76, 82, 79, 65, 68, 72, 69, 77, 80, 76, 73, 82, 85, 81, 78, 86, 91, 88, 84] },
  { position: "D1", job: "ninja", name: "Nagi Kisaragi", world: "Chocobo", values: [99, 98, 100, 98, 97, 96, 98, 97, 96, 95, 97, 96, 94, 96, 95, 93, 92, 94, 93, 95, 90, 92, 91, 94] },
  { position: "D2", job: "dragoon", name: "Ren Ashford", world: "Masamune", values: [88, 85, 90, 87, 92, 90, 94, 91, 86, 83, 89, 87, 80, 84, 88, 85, 78, 82, 85, 81, 75, 79, 82, 80] },
  { position: "D3", job: "dancer", name: "Mio Faye", world: "Tonberry", values: [58, 62, 66, 61, 70, 68, 72, 69, 55, 58, 63, 60, 45, 50, 56, 52, 68, 72, 65, 60, 78, 82, 76, 88] },
  { position: "D4", job: "blackMage", name: "Luca Noct", world: "Carbuncle", values: [23, null, 58, 62, 80, 85, 88, 82, 90, 94, 96, 93, 89, 92, 94, 90, 86, 88, 91, 87, 84, 86, 89, 92] },
];

function buildRows(): ApiRow[] {
  return ROSTER.map((entry, index) => {
    const tiers: Record<string, Array<Record<string, unknown>>> = {};
    let cursor = 0;
    for (const tier of TIERS) {
      tiers[String(tier.zoneId)] = tier.floors.map((floor) => {
        const best = entry.values[cursor] ?? null;
        const avg = entry.values[cursor + 1] ?? null;
        cursor += 2;
        return {
          floorIndex: floor.index,
          encounterNames: floor.encounterNames,
          bestPercent: best,
          medianPercent: avg,
          kills: best === null ? 0 : 5,
          bestAmount: 20000,
          fastestKill: 480000,
          activePercent: null,
        };
      });
    }
    const row = {
      name: entry.name,
      world: entry.world,
      canonicalId: 100000 + index,
      recruitmentJob: entry.job as ApiRow["recruitmentJob"],
      recruitmentJobName: entry.job,
      recruitmentPosition: entry.position,
      jobConfidence: "high",
      status: "ok" as const,
      tiers,
    };
    return row as unknown as ApiRow;
  });
}

const rows = buildRows();

// ジョブ不明（ポジションだけ分かる）行と、World 無しで候補が複数ある行も描画して確認する
rows[3] = {
  ...rows[3]!,
  recruitmentJob: null,

  recruitmentPosition: "ST",
  tiers: Object.fromEntries(Object.keys(rows[3]!.tiers).map((k) => [k, []])),
};
rows.push({
  name: "Raye Skystriker",
  world: undefined,
  canonicalId: null,
  recruitmentJob: "darkKnight",
  recruitmentJobName: "暗黒騎士",
  recruitmentPosition: "D2",
  jobConfidence: "high",
  status: "ambiguous",
  message: "World 表記が無いため候補が 2 件あります",
  candidates: [
    { canonicalId: 43123305, name: "Raye Skystriker", world: "Kujata", region: "JP", dataCenter: "Elemental" },
    { canonicalId: 27882677, name: "Raye Skystriker", world: "Anima", region: "JP", dataCenter: "Mana" },
  ],
  tiers: Object.fromEntries(TIERS.map((t) => [String(t.zoneId), []])),
} as never);

const COMPARE_RESPONSE = {
  tiers: TIERS,
  rows,
  warnings: [],
  meta: {
    servedFromCache: false,
    cacheStoreKind: "memory",
    credentialsConfigured: true,
    rateLimit: { limitPerHour: 720, pointsSpentThisHour: 210, pointsResetIn: 2400 },
    fetched: { characters: 8, tiers: 48 },
    failures: [],
    degraded: false,
  },
};

const browser = await chromium.launch({
  executablePath: join(homedir(), ".cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"),
  args: ["--no-sandbox", "--disable-crash-reporter", "--disable-breakpad"],
});

const page = await browser.newPage({ viewport: { width: 1586, height: 992 } });

await page.route("**/api/parse", (route) =>
  route.fulfill({
    json: {
      slots: ROSTER.map((entry) => ({
        characterId: null,
        name: entry.name,
        world: entry.world,
        recruitmentJob: entry.job as ApiRow["recruitmentJob"],
        recruitmentPosition: entry.position,
        jobConfidence: "high",
      })),
      warnings: [],
      stats: { totalLines: 8, candidateLines: 8, dropped: 0 },
    },
  }),
);
await page.route("**/api/compare", (route) => route.fulfill({ json: COMPARE_RESPONSE }));
await page.route("**/api/refresh", (route) => route.fulfill({ json: { ...COMPARE_RESPONSE, meta: { ...COMPARE_RESPONSE.meta, locked: false } } }));
await page.route("**/api/cell", (route) =>
  route.fulfill({ json: { jobIds: ["gunbreaker", "warrior", "darkKnight"] } }),
);

await page.goto(BASE_URL, { waitUntil: "networkidle" });
// hydration が終わる前に値を入れると React に上書きされるため、React がアタッチされるまで待つ
await page.waitForFunction(
  () => {
    const textarea = document.querySelector("textarea.recruitment-input");
    if (!textarea) return false;
    return Object.keys(textarea).some((key) => key.startsWith("__react"));
  },
  undefined,
  { timeout: 20_000 },
);

const sample = ROSTER.map((e) => `${e.position} ${e.name} / ${e.job} / ${e.world}`).join("\n");
await page.click("textarea.recruitment-input");
await page.keyboard.insertText(sample);
await page.waitForFunction(
  () => {
    const button = document.querySelector("button.btn-primary");
    return button instanceof HTMLButtonElement && !button.disabled;
  },
  undefined,
  { timeout: 10_000 },
);
await page.click("button.btn-primary");
await page.waitForSelector("table.compare tbody tr", { timeout: 15_000 });

await mkdir(join(OUT, ".."), { recursive: true });
await page.screenshot({ path: OUT });
console.log(`screenshot: ${OUT}`);

await browser.close();
