/**
 * FF14 ジョブ定義。
 *
 * 内部 ID は FFLogs の `specName` を camelCase にしたもの（例: Gunbreaker -> gunbreaker）。
 * FFLogs GraphQL の `zoneRankings(specName: "...")` / `encounterRankings(specName: "...")` は
 * この `specName` を受け取るため、変換テーブルを 1 箇所に閉じ込める。
 *
 * specId / specName は FFLogs の GameSpec から取得した実データで、
 * `gameData { classes { specs { id name slug } } }` の応答と一致する（docs/API-FINDINGS.md 参照）。
 */

export type Role = "tank" | "healer" | "melee" | "ranged" | "caster";

/**
 * 募集文で使われるポジション表記。
 * 実際には `MTorST` / `D1orD2` / `DPS` / `メレー` のように自由に書かれるため、
 * モデル側では文字列として保持する（仕様 §10: MT/ST のログ上判定は MVP では行わない）。
 */

export interface Job {
  /** 内部正規化 ID */
  id: JobId;
  /** FFLogs GameSpec.id */
  specId: number;
  /** FFLogs の specName（API に渡す値） */
  specName: string;
  /** 日本語での一般的なジョブ名 */
  nameJa: string;
  /** 英語ジョブ名 */
  nameEn: string;
  /** FF14 の 3 文字略称（例: GNB） */
  abbr: string;
  role: Role;
  /** XIVAPI の ClassJob ID。ジョブアイコン public/jobs/<id>.png の元データ */
  classJobId: number;
}

export type JobId =
  | "paladin"
  | "warrior"
  | "darkKnight"
  | "gunbreaker"
  | "whiteMage"
  | "scholar"
  | "astrologian"
  | "sage"
  | "monk"
  | "dragoon"
  | "ninja"
  | "samurai"
  | "reaper"
  | "viper"
  | "bard"
  | "machinist"
  | "dancer"
  | "blackMage"
  | "summoner"
  | "redMage"
  | "pictomancer";

export const JOBS: readonly Job[] = [
  { id: "paladin", specId: 9, specName: "Paladin", nameJa: "ナイト", nameEn: "Paladin", abbr: "PLD", role: "tank", classJobId: 19 },
  { id: "warrior", specId: 12, specName: "Warrior", nameJa: "戦士", nameEn: "Warrior", abbr: "WAR", role: "tank", classJobId: 21 },
  { id: "darkKnight", specId: 4, specName: "DarkKnight", nameJa: "暗黒騎士", nameEn: "Dark Knight", abbr: "DRK", role: "tank", classJobId: 32 },
  { id: "gunbreaker", specId: 17, specName: "Gunbreaker", nameJa: "ガンブレイカー", nameEn: "Gunbreaker", abbr: "GNB", role: "tank", classJobId: 37 },

  { id: "whiteMage", specId: 13, specName: "WhiteMage", nameJa: "白魔道士", nameEn: "White Mage", abbr: "WHM", role: "healer", classJobId: 24 },
  { id: "scholar", specId: 10, specName: "Scholar", nameJa: "学者", nameEn: "Scholar", abbr: "SCH", role: "healer", classJobId: 28 },
  { id: "astrologian", specId: 1, specName: "Astrologian", nameJa: "占星術師", nameEn: "Astrologian", abbr: "AST", role: "healer", classJobId: 33 },
  { id: "sage", specId: 19, specName: "Sage", nameJa: "賢者", nameEn: "Sage", abbr: "SGE", role: "healer", classJobId: 40 },

  { id: "monk", specId: 7, specName: "Monk", nameJa: "モンク", nameEn: "Monk", abbr: "MNK", role: "melee", classJobId: 20 },
  { id: "dragoon", specId: 5, specName: "Dragoon", nameJa: "竜騎士", nameEn: "Dragoon", abbr: "DRG", role: "melee", classJobId: 22 },
  { id: "ninja", specId: 8, specName: "Ninja", nameJa: "忍者", nameEn: "Ninja", abbr: "NIN", role: "melee", classJobId: 30 },
  { id: "samurai", specId: 15, specName: "Samurai", nameJa: "侍", nameEn: "Samurai", abbr: "SAM", role: "melee", classJobId: 34 },
  { id: "reaper", specId: 18, specName: "Reaper", nameJa: "リーパー", nameEn: "Reaper", abbr: "RPR", role: "melee", classJobId: 39 },
  { id: "viper", specId: 20, specName: "Viper", nameJa: "ヴァイパー", nameEn: "Viper", abbr: "VPR", role: "melee", classJobId: 41 },

  { id: "bard", specId: 2, specName: "Bard", nameJa: "吟遊詩人", nameEn: "Bard", abbr: "BRD", role: "ranged", classJobId: 23 },
  { id: "machinist", specId: 6, specName: "Machinist", nameJa: "機工士", nameEn: "Machinist", abbr: "MCH", role: "ranged", classJobId: 31 },
  { id: "dancer", specId: 16, specName: "Dancer", nameJa: "踊り子", nameEn: "Dancer", abbr: "DNC", role: "ranged", classJobId: 38 },

  { id: "blackMage", specId: 3, specName: "BlackMage", nameJa: "黒魔道士", nameEn: "Black Mage", abbr: "BLM", role: "caster", classJobId: 25 },
  { id: "summoner", specId: 11, specName: "Summoner", nameJa: "召喚士", nameEn: "Summoner", abbr: "SMN", role: "caster", classJobId: 27 },
  { id: "redMage", specId: 14, specName: "RedMage", nameJa: "赤魔道士", nameEn: "Red Mage", abbr: "RDM", role: "caster", classJobId: 35 },
  { id: "pictomancer", specId: 21, specName: "Pictomancer", nameJa: "ピクトマンサー", nameEn: "Pictomancer", abbr: "PCT", role: "caster", classJobId: 42 },
] as const;

const BY_ID = new Map<string, Job>(JOBS.map((j) => [j.id, j]));
const BY_SPEC_NAME = new Map<string, Job>(JOBS.map((j) => [j.specName.toLowerCase(), j]));
const BY_CLASS_JOB_ID = new Map<number, Job>(JOBS.map((j) => [j.classJobId, j]));

export function getJob(id: JobId): Job {
  const job = BY_ID.get(id);
  if (!job) throw new Error(`unknown job id: ${id}`);
  return job;
}

/** FFLogs の specName（大文字小文字を問わない）から内部 JobId へ。 */
export function jobFromSpecName(specName: string | null | undefined): Job | undefined {
  if (!specName) return undefined;
  return BY_SPEC_NAME.get(specName.toLowerCase());
}

/** FF14 の ClassJob ID から内部 JobId へ。 */
export function jobFromClassJobId(classJobId: number): Job | undefined {
  return BY_CLASS_JOB_ID.get(classJobId);
}

/** ジョブアイコンの公開パス（public/jobs/<jobId>.png）。 */
export function jobIconPath(id: JobId): string {
  return `/jobs/${id}.png`;
}


/** ロールの表示順。 */
export const ROLE_ORDER: readonly Role[] = ["tank", "healer", "melee", "ranged", "caster"];

/**
 * ロールごとの色（mock.png から実測）。
 * 表のロール表示とジョブアイコンの背景に使う。
 */
export const ROLE_COLORS: Record<Role, string> = {
  tank: "#316ef5",
  healer: "#45a23c",
  melee: "#ef4445",
  ranged: "#ef4445",
  caster: "#ef4445",
};

export function roleColor(id: JobId): string {
  return ROLE_COLORS[getJob(id).role];
}

/**
 * 左側装備（胴・脚など）が共通のグループ。**同じグループなら着替えが現実的**。
 * FF14 では装備の持ち替えコストが高いので、「1〜4 層をこのジョブで攻略した人は
 * 同じ装備のジョブも触っていた」可能性が高い。
 */
export const GEAR_SET: Readonly<Record<JobId, string>> = {
  paladin: "fending",
  warrior: "fending",
  darkKnight: "fending",
  gunbreaker: "fending",
  whiteMage: "healing",
  scholar: "healing",
  astrologian: "healing",
  sage: "healing",
  monk: "striking",
  samurai: "striking",
  dragoon: "maiming",
  reaper: "maiming",
  ninja: "scouting",
  viper: "scouting",
  bard: "aiming",
  machinist: "aiming",
  dancer: "aiming",
  blackMage: "casting",
  summoner: "casting",
  redMage: "casting",
  pictomancer: "casting",
};

/**
 * アクセサリが共通のグループ（＝ロール相当）。
 * 近接は striking / maiming / scouting で左装備は違うが、アクセサリは共通。
 */
export const ACCESSORY_GROUP: Readonly<Record<JobId, string>> = {
  paladin: "fending",
  warrior: "fending",
  darkKnight: "fending",
  gunbreaker: "fending",
  whiteMage: "healing",
  scholar: "healing",
  astrologian: "healing",
  sage: "healing",
  monk: "slaying",
  samurai: "slaying",
  dragoon: "slaying",
  reaper: "slaying",
  ninja: "slaying",
  viper: "slaying",
  bard: "aiming",
  machinist: "aiming",
  dancer: "aiming",
  blackMage: "casting",
  summoner: "casting",
  redMage: "casting",
  pictomancer: "casting",
};

/**
 * ヒーラーの役割。
 * 固定ではピュア（純ヒール）とバリア（軽減）を 1 人ずつ入れるのが一般的なので、
 * H1 ならピュア、H2 ならバリアを先に調べると当たりやすい。
 */
export const HEALER_KIND: Readonly<Partial<Record<JobId, "pure" | "barrier">>> = {
  whiteMage: "pure",
  astrologian: "pure",
  scholar: "barrier",
  sage: "barrier",
};

/**
 * ヒーラー枠をピュア / バリアに分けて、先に調べるほうから返す。
 * ヒーラー枠でなければ null。
 *
 * 分けておくと、ピュアを持っている人なら 2 alias で見つかって打ち切れる
 * （4 つまとめて調べると 4 alias かかる）。
 */
export function healerPriorityGroups(position?: string): JobId[][] | null {
  const roles = positionRoles(position);
  if (roles.length !== 1 || roles[0] !== "healer") return null;

  const tokens = (position ?? "").toUpperCase().split(/[\s/／]+/).filter(Boolean);
  const wantsBarrier = tokens.some((t) => /^(H2|BH)$/.test(t));
  const pure = JOBS.filter((job) => job.role === "healer" && HEALER_KIND[job.id] === "pure").map((job) => job.id);
  const barrier = JOBS.filter((job) => job.role === "healer" && HEALER_KIND[job.id] === "barrier").map((job) => job.id);
  return wantsBarrier ? [barrier, pure] : [pure, barrier];
}

export function gearSetOf(jobId: JobId): string {
  return GEAR_SET[jobId];
}

/** 同じ左装備のジョブ（自分を除く）。 */
export function jobsSharingGear(jobId: JobId, pool: readonly JobId[] = JOBS.map((job) => job.id)): JobId[] {
  const gear = GEAR_SET[jobId];
  return pool.filter((id) => id !== jobId && GEAR_SET[id] === gear);
}

/**
 * ロールの「近さ」。
 *
 * ジョブ不明の枠で、そのポジションのロールにログが無かったときに
 * 「どのロールから順に探すか / 並べるか」を決める。
 *
 * 考え方:
 *  - タンクは前線・物理なので、まず近接。次に同じ非 DPS のヒーラー、そのあと遠隔。
 *  - 近接は同じ前線のタンクが近い。
 *  - 遠隔とキャスターは同じ後衛なので互いに近い。
 * パッチや好みで変えやすいよう、ここ 1 か所にまとめている。
 */
export const ROLE_SIMILARITY: Readonly<Record<Role, readonly Role[]>> = {
  tank: ["tank", "melee", "healer", "ranged", "caster"],
  melee: ["melee", "tank", "ranged", "caster", "healer"],
  ranged: ["ranged", "caster", "healer", "melee", "tank"],
  caster: ["caster", "ranged", "healer", "melee", "tank"],
  healer: ["healer", "caster", "ranged", "tank", "melee"],
};

/**
 * ポジションに応じたロールの優先順（重複なし）。
 * ポジションからロールが決まらない場合は全ロールを既定順で返す。
 */
export function rolePriorityFor(position?: string): Role[] {
  const own = positionRoles(position);
  // まずポジションから決まるロール（D1〜D4 なら近接・遠隔・キャスター）を先頭に置き、
  // そのあと「近いロール」を足していく。
  const order: Role[] = [...own];
  for (const role of own) {
    for (const near of ROLE_SIMILARITY[role]) {
      if (!order.includes(near)) order.push(near);
    }
  }
  return order.length > 0 ? order : [...ROLE_ORDER];
}

/**
 * ポジションのロールにログが無かったときに探す残りのジョブを、
 * 「近いロール」順に並べて返す。
 */
export function fallbackJobOrder(position?: string): JobId[] {
  const ownRoles = new Set(positionRoles(position));
  return rolePriorityFor(position)
    .filter((role) => !ownRoles.has(role))
    .flatMap((role) => JOBS.filter((job) => job.role === role).map((job) => job.id));
}

/**
 * ジョブ探索を「ロール単位のグループ」に分けて、近い順に並べて返す。
 *
 * 全 21 ジョブを一度に引くと 21 alias（実測 約 105 points）かかる。
 * 近いロールから順に試して**最初に見つかったグループで打ち切る**ことで、
 * 例: ST 募集でタンクにログが無い場合、次の近接（6 ジョブ）までで止まり 約 50 points で済む。
 *
 * 先頭のグループは募集文に着替え可の記載があればそれを使う。
 */
export function jobProbeGroups(
  position?: string,
  declaredAlternates?: readonly JobId[],
  knownJobs?: readonly JobId[],
): JobId[][] {
  const known = new Set(knownJobs ?? []);

  const groups: JobId[][] = [];
  if (declaredAlternates && declaredAlternates.length > 0) {
    groups.push([...new Set(declaredAlternates)], jobPickerOrder(position), fallbackJobOrder(position));
  } else {
    // 1) まず募集ポジションのロール（ST ならタンク）。
    //    ヒーラー枠はピュア / バリアに分けて、当たった時点で打ち切れるようにする。
    const healerGroups = healerPriorityGroups(position);
    if (healerGroups) groups.push(...healerGroups);
    else groups.push(jobPickerOrder(position));

    // 2) すでにログが分かっているジョブと**装備が共通**のジョブ。
    //    1〜4 層をメインジョブで攻略した人は、同じ装備のジョブも触っている可能性が高い。
    //    例: 占星術師のログが分かっていれば、同じ healing 装備の学者・賢者を次に調べる。
    const gearPeers = [...known].flatMap((jobId) => jobsSharingGear(jobId));
    if (gearPeers.length > 0) groups.push(gearPeers);

    // 3) 残りをロールの近さ順に
    const ownRoles = new Set(positionRoles(position));
    for (const role of rolePriorityFor(position)) {
      if (ownRoles.has(role)) continue;
      groups.push(JOBS.filter((job) => job.role === role).map((job) => job.id));
    }
  }

  // すでにログが分かっているジョブは調べ直さない（重複も落とす）
  const seen = new Set<JobId>();
  const cleaned: JobId[][] = [];
  for (const group of groups) {
    const list: JobId[] = [];
    for (const jobId of group) {
      if (known.has(jobId) || seen.has(jobId)) continue;
      seen.add(jobId);
      list.push(jobId);
    }
    if (list.length > 0) cleaned.push(list);
  }
  return cleaned;
}

/**
 * 「ログの有無を調べたジョブ」と「ログがあると分かっているジョブ」で
 * 全 21 ジョブを覆えているか。
 *
 * これが true になって初めて「他にログのあるジョブは無い」と言い切れる。
 * false の間は取り漏らしの可能性があるので、UI でもそう示す。
 */
export function isFullyScanned(probedJobs: readonly JobId[], knownJobs: readonly JobId[]): boolean {
  return new Set<JobId>([...probedJobs, ...knownJobs]).size >= JOBS.length;
}

/** 探索で見つかったジョブを、ポジションとの近さ順に並べ替える。 */
export function sortJobsForPosition(jobs: readonly JobId[], position?: string): JobId[] {
  const priority = rolePriorityFor(position);
  return [...jobs].sort((a, b) => {
    const ai = priority.indexOf(getJob(a).role);
    const bi = priority.indexOf(getJob(b).role);
    if (ai !== bi) return ai - bi;
    return JOBS.findIndex((j) => j.id === a) - JOBS.findIndex((j) => j.id === b);
  });
}

/**
 * MT/ST でジョブ不明のときに優先表示するタンク。
 * 「ガ暗ナ戦」はあくまで現行バランスでの並びなので、パッチごとにここを差し替える。
 */
export const TANK_PICKER_ORDER: readonly JobId[] = ["gunbreaker", "darkKnight", "paladin", "warrior"];

/** ポジション表記から、あり得るロールを推定する。 */
export function positionRoles(position?: string): Role[] {
  if (!position) return [...ROLE_ORDER];
  const tokens = position.toUpperCase().split(/[\s/／]+/).filter(Boolean);
  const roles = new Set<Role>();

  for (const token of tokens) {
    if (/^(MT|ST|OT|T[12])$/.test(token)) roles.add("tank");
    else if (/^(H[12]|PH|BH|HEAL|HEALER)$/.test(token)) roles.add("healer");
    else if (/^(D[1-4]|DPS)$/.test(token)) {
      roles.add("melee");
      roles.add("ranged");
      roles.add("caster");
    }
  }

  return roles.size > 0 ? ROLE_ORDER.filter((r) => roles.has(r)) : [...ROLE_ORDER];
}

/**
 * ジョブ不明の枠で選択肢に出すジョブを、ポジションにふさわしい順に並べる。
 *
 * 例: ST なら「ガ暗ナ戦」だけを提示し、DPS やヒーラーは出さない。
 * これは「ST 適性が高い順」であり、ログ上の実際のロールを断定するものではない（仕様 §10）。
 */
export function jobPickerOrder(position?: string): JobId[] {
  const roles = positionRoles(position);
  const tokens = (position ?? "").toUpperCase().split(/[\s/／]+/).filter(Boolean);
  const isTankSlot = tokens.some((t) => /^(MT|ST|OT|T[12])$/.test(t));

  if (isTankSlot && roles.length === 1 && roles[0] === "tank") {
    return [...TANK_PICKER_ORDER];
  }

  // H1 / PH はピュア、H2 / BH はバリアを先に調べる（固定では 1 人ずつ入れるのが一般的）
  if (roles.length === 1 && roles[0] === "healer") {
    const wantsBarrier = tokens.some((t) => /^(H2|BH)$/.test(t));
    const pure = JOBS.filter((job) => job.role === "healer" && HEALER_KIND[job.id] === "pure").map((job) => job.id);
    const barrier = JOBS.filter((job) => job.role === "healer" && HEALER_KIND[job.id] === "barrier").map((job) => job.id);
    return wantsBarrier ? [...barrier, ...pure] : [...pure, ...barrier];
  }

  return JOBS.filter((job) => roles.includes(job.role)).map((job) => job.id);
}
