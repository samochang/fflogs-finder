/**
 * ジョブアイコンを取得して public/jobs/<jobId>.png に保存する。
 *
 *   npm run fetch:icons
 *
 * 出典: XIVAPI の UI アイコン（FF14 の ClassJob ID に対応する 0620XX_hr1.png）。
 * FFLogs 自身のアセットホスト (assets.rpglogs.com) は直リンクに 403 を返すため使わない。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { JOBS } from "../src/lib/jobs/jobs.ts";

const OUT_DIR = new URL("../public/jobs/", import.meta.url);
await mkdir(OUT_DIR, { recursive: true });

let ok = 0;
const failed: string[] = [];

for (const job of JOBS) {
  const id = String(62000 + job.classJobId).padStart(6, "0");
  const url = `https://xivapi.com/i/062000/${id}_hr1.png`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(new URL(`${job.id}.png`, OUT_DIR), buffer);
    ok += 1;
    console.log(`  ok   ${job.id.padEnd(14)} ${url} (${buffer.length} bytes)`);
  } catch (error) {
    failed.push(`${job.id}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`  FAIL ${job.id.padEnd(14)} ${url}`);
  }
}

console.log(`\n${ok}/${JOBS.length} 件のジョブアイコンを public/jobs/ に保存しました。`);
if (failed.length > 0) {
  console.log("失敗:", failed.join(", "));
  process.exitCode = 1;
}
