# FFLogs v2 API 実測メモ

仕様 §39「開発時の重要ポイント」に対して、**推測ではなく実際の query / response で確認した結果**をまとめる。

再現に使ったスクリプト:

| スクリプト | 用途 |
| --- | --- |
| `scripts/gql.mjs` | 任意の GraphQL クエリを投げて生 JSON を見る |
| `scripts/introspect.mjs` / `scripts/schema.mjs` | スキーマのダンプ（`scripts/_schema.json`） |
| `scripts/dump-tiers.mts` | 対象 Tier の解決結果を確認（`npm run fetch:tiers`） |
| `scripts/measure-points.mts` | API points の実測（`npm run measure:points`） |
| `scripts/fetch-job-icons.mts` | ジョブアイコンの取得（`npm run fetch:icons`） |
| `scripts/e2e-check.mts` | 実データでの通し確認（`npm run e2e`） |
| `scripts/screenshot.mts` | API をスタブした UI 撮影（`npm run screenshot`） |

認証情報は `.env` の `FFL_CLIENT_ID` / `FFL_CLIENT_SECRET`。

---

## 1. 接続

* OAuth2 client credentials: `POST https://www.fflogs.com/oauth/token`（`grant_type=client_credentials`、Basic 認証）
  * 実測 `expires_in: 31104000`（360 日）。トークンは長期キャッシュしてよい。
* GraphQL: `POST https://www.fflogs.com/api/v2/client`、`Authorization: Bearer <token>`

### Query ルートフィールド（実測）

```
characterData, gameData, guildData, progressRaceData, rateLimitData,
reportData, userData, worldData, reportComponentData, systemReportComponentData
```

`character` はルートには無い。**`characterData { character(...) }`** が正しい。

---

## 1.5 Active（アクティブ率）の求め方

`character` 系エンドポイントに **Active は無い**。FFLogs の "Active" 列は
**Report の DamageDone テーブル**にしかなく、`report code` と `fightID` が必要。

そのため 2 段階になる:

1. `character.encounterRankings(encounterID, specName)` → Best Perf の fight の
   `report.code` と `fightID` を得る（`extractBestFight`）
2. `report.table(dataType: DamageDone, fightIDs: [...])` →
   `data.entries[].activeTime` と `data.totalTime` を読む

### 計算（重要）

`activeTime` は**ミリ秒**であって % ではない。

```
Active % = activeTime / table.data.totalTime * 100
```

実測（Wata Gasi / AAC Heavyweight P1 / 占星術師）:

```
activeTime = 507225 ms
totalTime  = 508871 ms
combatTime = 508871 ms
→ 507225 / 508871 * 100 = 99.68%
```

`activeTime` をそのまま表示すると **397250%** のような値になる（実装当初のバグ）。

## 2. レート制限（仕様 §25）

### 回復の挙動（実測・確定）

**固定 1 時間のウィンドウで、境界で一括リセットされる。ローリングではない。**

5 分おきに 17 サンプル取り、ウィンドウ境界をまたいだ観測:

```
t=   0s  spent=  3  resetIn=3432
t=3003s  spent= 13  resetIn= 430
t=3303s  spent= 14  resetIn= 129
t=3603s  spent=  1  resetIn=3600   ← 境界。14 → 1 に一括で落ちた
t=3904s  spent=  2  resetIn=3300
```

* サンプル間の増分は毎回ちょうど +1（計測クエリ自身の消費ぶん）。
  つまり**放置しても points は減らない**
* `pointsResetIn` は実時間どおりに減る（300 秒ごとに -300、窓は 3600 秒）
* よって残量は `limit - spent`（境界を越えたら spent = 0）でよい。
  「経過時間に比例して回復」とするのは**誤り**


```graphql
{ rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }
```

実測値:

```json
{ "limitPerHour": 720, "pointsSpentThisHour": 1, "pointsResetIn": 3600 }
```

* **points 上限 720 / 時間**。上限に達すると HTTP 429 と
  `{"status":429,"error":"Too many requests. ..."}` が返り、`Retry-After` にリセットまでの秒数が入る。
* 429 時のレスポンスヘッダには `x-ratelimit-limit: 800` / `x-ratelimit-remaining: N` も付く
  （リクエスト数とは別枠の points 制限があると解釈できる）。
* `pointsSpentThisHour` は**リクエスト直後には確定せず、1 リクエスト分遅れて見える**。
  正確に測るには値が安定するまで読み直す必要がある（`scripts/measure-points.mts` はこの settle 方式）。
  この遅延のため「1 リクエストにまとめれば安い」と早合点しやすいので注意。

### 消費ポイント実測

`npm run measure:points` の結果（`--cases=A,B,C,F,H`）。

`npm run measure:points` の結果（`--cases=G,A,B,C,F,H`、2026-10-09 実測）。

| ケース | 消費 points | 備考 |
| --- | --- | --- |
| G. `rateLimitData` 単体 | **1** | 計測の基準。読み取り自体も 1 point |
| A. 1 character × 1 Tier | **5.01** | |
| B. 1 character × 3 Tier | **15.01** | 5 × 3 |
| C. 1 character × 6 Tier | **30.01** | 5 × 6 |
| F. `recentReports`（last-update 確認用） | **1** | 非常に安い |
| T. zone カタログ（`worldData.expansions.zones`） | **4** | `partitions` を含めても同じ。24h キャッシュ |
| W. ワールド一覧（`worldData.regions.servers`） | **31.3** | 125 ワールド × 6 リージョン。**静的生成に切替**（後述） |
| H. Active 取得（`report.table(DamageDone)`） | 未測定 | 対象 fight が無くスキップ。1 fight あたり数 points 程度と推定 |
| — キャラクター 1 件の特定 | **約 1** | `characterData.character(...)` を 1 回 |

そこから導かれる実測値:

| ケース | 消費 points | 算出根拠 |
| --- | --- | --- |
| D. 8 character × 6 Tier（1 query に集約） | **約 240** | 48 alias × 5 |
| E. 8 character × 6 Tier（キャラごとに分割） | **約 240** | (1 char × 6 Tier) × 8 = 30 × 8 |

D と E はほぼ同じ。**`zoneRankings` 1 alias あたり約 5 points**で、
HTTP リクエストをまとめても points は減らない。

実際のアプリでの確認（`scripts/e2e-check.mts`）:

* 8 人 × 6 Tier の初回取得: `pointsSpentThisHour` が **137 → 391**（+254）。うちキャラクター特定 8 件ぶんが約 8。
* 同じ入力での 2 回目: **+0**（キャッシュのみ）。
* `/api/refresh` による再取得: **391 → 631**（+240）。

**結論**

* 消費ポイントは **HTTP リクエスト数ではなく、返ってくるランキング（alias）の数**に比例する。
  `zoneRankings` 1 つにつき約 5 points。
* したがって「8 人 × 6 Tier を 1 query にまとめる」ことで減るのは**レイテンシであって points ではない**（仕様 §24 の注記どおり）。
  1 query にまとめる価値は「8 往復 → 1 往復」の待ち時間短縮にある。
* 8 人 × 6 Tier の初回取得で約 240 points、つまり **1 時間に 3 回ぶんしか取得できない**。
  → **通常表示では API を叩かない / 更新ボタンでだけ叩く / refresh lock で多重化を防ぐ**という仕様 §26〜§28 の方針は必須。
* 計測時の注意: `pointsSpentThisHour` は 1 リクエスト分遅れて反映される。
  これを知らないと「8 人まとめると 30 points で済む」と誤読する（実際に一度誤読した）。
  `scripts/measure-points.mts` は値が安定するまで読み直す settle 方式で測っている。

---

## 3. JSON スカラーには sub-selection を書けない

`Character.zoneRankings` / `Character.encounterRankings` / `Report.table` の型は **`JSON`** スカラー。

```graphql
# NG: Field "zoneRankings" of type "JSON" must not have a sub selection.
{ characterData { character(id: 1) { zoneRankings(zoneID: 54) { zone } } } }
```

つまり **返ってくるオブジェクトの形はスキーマから分からない**。本ドキュメントの形はすべて実レスポンスから確定させたもの。
また、JSON スカラーは「要求したフィールドだけ返す」ことができないため、クエリ側でコストを絞ることはできない。

---

## 4. キャラクター特定（仕様 §11）

```graphql
characterData {
  character(id: Int, name: String, serverSlug: String, serverRegion: String, lodestoneID: Int)
  characters(guildID: Int, limit: Int, page: Int)
}
```

* **名前だけでの曖昧検索 API は存在しない**。`name` + `serverSlug` + `serverRegion` の完全一致で 1 件引く形。
  * `characters` は `guildID` でしか絞れない（ページングのみ）。
  * → 仕様 §11 の「候補が複数ある場合は候補選択 UI」は、**World が分かっていれば候補は一意**なので実質不要。
  * 代わりに **World 表記が無い場合に特定できない**ことが実務上の制約になる。UI では理由を明示する。
* `lodestoneID` でも引ける（Lodestone のキャラ ID から逆引きできる）。

### World が分からない場合（重要）

**FFLogs はキャラクター名だけでは特定できない。** 実測で確認した結果:

| クエリ | 結果 |
| --- | --- |
| `name` + `serverSlug` + `serverRegion` | ✅ 取得できる |
| `name` + `serverRegion`（serverSlug なし） | ❌ `null` |
| `name` のみ | ❌ `null` |
| 誤った `serverSlug` + 正しい `serverRegion` | ❌ `null`（部分一致もしない） |
| `lodestoneID` | ✅ 取得できる |

そこで本アプリは **Lodestone のキャラクター検索**で World を解決する。

```
GET https://jp.finalfantasyxiv.com/lodestone/character/?q=<名前>
```

検索結果の HTML から名前・World・データセンター・Lodestone ID が取れる（実測）:

```html
<div class="entry"><a href="/lodestone/character/52195971/" class="entry__link">
  <p class="entry__name">Raye Skystrikerace</p>
  <p class="entry__world"><i class="..."></i>Durandal [Gaia]</p>
```

* 検索は曖昧一致なので、`Raye Skystriker` は **Kujata [Elemental] と Anima [Mana] の 2 件**が完全一致で返る。
  → 1 件に絞れない場合は候補選択 UI を出す（仕様 §11 がここで効いてくる）。
* 同じ名前のワールドがリージョンをまたいで存在する（**KR の Carbuncle / Chocobo / Fenrir / Tonberry は JP と、
  Moogle は EU と衝突**）。本アプリは JP を優先しつつ、失敗したら次リージョンを試す。
* 募集文に Lodestone の**キャラクター URL** があれば `lodestoneID` で直接引けるため、名前検索すら不要。

```
GET https://jp.finalfantasyxiv.com/lodestone/character/23691783/
  -> <p class="frame__chara__name">Circle Princess</p>
  -> <p class="frame__chara__world">Belias [Meteor]</p>
```

### ワールド → データセンター

FFLogs は region（JP/NA/EU…）しか返さないため、DC は Lodestone のワールドステータスページから取る。

```
GET https://jp.finalfantasyxiv.com/lodestone/worldstatus/

<div class="world-dcgroup__item">
  <h2 class="world-dcgroup__header">Elemental</h2>
  ...
  <div class="world-list__world_name"><p>Aegis</p></div>
```

実測で **85 ワールド / 11 論理 DC**。`npm run fetch:world-dc` で静的に書き出す。
（2026-10 時点で Elemental は 8 ワールド。Unicorn / Ramuh は Meteor に移っており、
記憶で書いた表は間違っていた。必ず生成すること）

### Character のフィールド（実測）

```
canonicalID: Int!   claimed: Boolean   encounterRankings: JSON   gameData: JSON
guildRank: Int!     guilds: [Guild]    hidden: Boolean!          id: Int!
lodestoneID: Int!   name: String!      recentReports: ReportPagination
server: Server!     zoneRankings: JSON
```

* `hidden: Boolean!` が**ランキング非公開フラグ**（仕様 §32）。
  `hidden: true` のキャラクターは `zoneRankings` が返らないので、迂回取得せず「非公開」と表示する。
* `server { name, slug, region { name, slug } }` が World / Region の解決に使える。

---

## 5. zoneRankings（Best / Avg / Kills の出典）

```graphql
characterData {
  character(name: "…", serverSlug: "…", serverRegion: "JP") {
    z54: zoneRankings(zoneID: 54, specName: "Gunbreaker", difficulty: 101, metric: dps)
  }
}
```

引数（実測）: `zoneID, specName, difficulty, metric, partition, timeframe, byBracket, role, className, compare, size, includePrivateLogs`

### 実レスポンス（Anabaseios / zoneID 54 の例）

```json
{
  "bestPerformanceAverage": null,
  "medianPerformanceAverage": null,
  "difficulty": 101,
  "metric": "dps",
  "partition": -1,
  "zone": 54,
  "size": 8,
  "allStars": [],
  "rankings": [
    {
      "encounter": { "id": 88, "name": "Kokytos" },
      "rankPercent": null,
      "medianPercent": null,
      "allStars": null,
      "lockedIn": true,
      "totalKills": 0,
      "fastestKill": 0,
      "bestAmount": 0,
      "spec": null
    }
  ]
}
```

### フィールドの対応（仕様 §14 / §15）

| 仕様の項目 | フィールド | 備考 |
| --- | --- | --- |
| Best Perf | `rankings[].rankPercent` | その encounter の最高 parse 百分位 |
| Avg Perf | `rankings[].medianPercent` | FFLogs の "Median Perf." に相当 |
| Kills | `rankings[].totalKills` | |
| Best Amount | `rankings[].bestAmount` | |
| Fastest Kill | `rankings[].fastestKill` | ms |
| どのジョブの集計か | `rankings[].spec` | 例 `"WhiteMage"` |
| Tier 全体の平均 | `bestPerformanceAverage` / `medianPerformanceAverage` | zone 単位 |

**重要な確認結果（仕様 §15）**

* **`zoneRankings` に「平均（average）」フィールドは無い。** 層ごとに取れる百分位は
  `rankPercent`（Best）と `medianPercent`（Median）の 2 つだけ。
  本アプリの比較表「上段 Best / 下段 Avg」はこの 2 つを表示している。
  UI 上は Avg と略しているが、**FFLogs のフィールド名は Median Perf.** であることを
  セル詳細に明記している（独自の平均計算はしていない）。
* 層ごとの「average」が存在するのは `encounterRankings` 側の `averagePerformance` のみ（後述）。
  そちらは 1 encounter = 1 リクエストになるため、通常表示では使わない。
* `zoneRankings` を `specName` 無しで呼ぶと、そのキャラクターの**既定ジョブ 1 つ**の結果だけが返る
  （複数ジョブ分は返らない）。ジョブを変えるには `specName` を指定して引き直す必要がある。

### partition

* `partition: -1` は「指定なし」を意味するセンチネルとして返る。
* zone ごとの既定パーティションは `worldData.zones[].partitions[].default` で取得できる。
  本アプリは Tier カタログから既定パーティション名を表示に使い、ランキング取得自体は
  FFLogs の既定（引数省略）に任せている。

---

## 6. encounterRankings

```graphql
characterData { character(id: …) { encounterRankings(encounterID: 65, specName: "WhiteMage", difficulty: 101, metric: dps) } }
```

引数: `encounterID, specName, difficulty, metric, partition, timeframe, byBracket, role, className, compare, size, includePrivateLogs, includeCombatantInfo, includeOtherPlayers, includeHistoricalGraph`

### 実レスポンス

```json
{
  "bestAmount": 4429.03,
  "medianPerformance": 72.17,
  "averagePerformance": 72.17,
  "totalKills": 1,
  "fastestKill": 516287,
  "difficulty": 101,
  "metric": "dps",
  "partition": 3,
  "zone": 29,
  "ranks": [
    {
      "lockedIn": true,
      "rankPercent": 72.17,
      "historicalPercent": 72.17,
      "todayPercent": 33.9,
      "rankTotalParses": 7143,
      "historicalTotalParses": 7143,
      "todayTotalParses": 36107,
      "guild": { "id": null, "name": null, "faction": null },
      "report": { "code": "Q9fMNhYRB7vjkC68", "startTime": 1565084520682, "fightID": 2 },
      "duration": 516287,
      "startTime": 1565084860625,
      "amount": 4429.03,
      "bracketData": 5,
      "spec": "WhiteMage",
      "bestSpec": "WhiteMage",
      "class": 1,
      "aDPS": 4554.63,
      "rDPS": 4429.03,
      "pDPS": 4554.63
    }
  ]
}
```

* `medianPerformance` と `averagePerformance` の**両方**が存在する。kill が 1 件だと同値になる。
* `ranks[].report.code` と `ranks[].report.fightID` から、**その kill の Report / fight を特定できる**。
  これが Active 取得の入口になる。

---

## 7. Active（仕様 §14 / §16）

### 重要な確認結果

**`characterData` 配下に "Active" 相当のフィールドは存在しない。**
スキーマ全 102 型をダンプして `active` / `uptime` / `percent` を検索したが、
ヒットするのは `Rank.percentile` と `ReportFight.bossPercentage` / `fightPercentage` のみ。

FFLogs が「Active」として表示しているのは **Damage Done テーブルの `activeTime` 列**で、
Report 側の API からしか取れない。

```graphql
reportData { report(code: "…") { table(dataType: DamageDone, fightIDs: [59]) } }
```

```json
{
  "data": {
    "entries": [
      { "name": "Aji-man End", "id": 315, "type": "Player",
        "total": 123456, "activeTime": 98.42, "activeTimeReduced": 96.1, "…": "…" }
    ],
    "totalTime": 512345, "combatTime": 498765
  }
}
```

### 制約

1. **アーカイブ済み Report は client credentials では読めない。**
   ```json
   { "errors": [ { "message": "This report has been archived. Subscribing users can access the report content via the /user API endpoint." } ] }
   ```
   2019 年頃の Report はこれに該当した。古い Tier では Active を取得できない。
2. 取得には `encounterRankings`（Best Perf の fight 特定）+ `report.table` の 2 リクエストが要る。
   全 8 人 × 24 層ぶんを先に取ると points が大きく膨らむ。

### 本アプリでの扱い

* 通常表示（Best / Avg / Kills）には含めず、**セル詳細を開いたときにだけ遅延取得**する（仕様 §22 の考え方を Active にも適用）。
* 取得できた値はキャッシュに書き戻す。
* 取得できない場合は理由（アーカイブ済み / fight 不明 など）を UI に出す。
* **GCD uptime の自前計算は行わない**（仕様 §16）。

---

## 8. 対象コンテンツ（仕様 §12）

`worldData { expansions { zones { … } } }` から判定する。

```graphql
worldData {
  expansions { id name zones {
    id name frozen
    difficulties { id name sizes }
    encounters { id name }
    partitions { id name compactName default }
  } }
}
```

* 難易度 ID: **`101` = Savage / `100` = Normal**（例 `["101:Savage/[8]", "100:Normal/[8]"]`）。
* `difficulties[].sizes` で人数が分かる。零式レイドは `[8]`。
* 判定条件は「Savage を持ち、サイズに 8 を含み、encounter が 4 つ以上」。
  これで Criterion（`[4]`）・Delubrum Reginae（`[48]`）・The Forked Tower（`[48]`）・Deep Dungeons が除外できる。
* 新しい順は zone ID の降順で安定していた。

実測（2026-10 時点）で選ばれた 6 Tier:

| zoneID | 名前 | 拡張 | 層 |
| --- | --- | --- | --- |
| 73 | AAC Heavyweight | Dawntrail | Vamp Fatale / Red Hot and Deep Blue / The Tyrant / Lindwurm + Lindwurm II |
| 68 | AAC Cruiserweight | Dawntrail | Dancing Green / Sugar Riot / Brute Abombinator / Howling Blade |
| 62 | AAC Light-Heavyweight | Dawntrail | Black Cat / Honey B. Lovely / Brute Bomber / Wicked Thunder |
| 54 | Anabaseios | Endwalker | Kokytos / Pandaemonium / Themis / Athena + Pallas Athena |
| 49 | Abyssos | Endwalker | Proto-Carbuncle / Hegemone / Agdistis / Hephaistos + Hephaistos II |
| 44 | Asphodelos | Endwalker | Erichthonios / Hippokampos / Phoinix / Hesperos + Hesperos II |

### 層（P1〜P4）への畳み方

零式の最終層は 2 フェーズ構成で **encounter が 2 つに分かれる**ため、encounter 数が 5 の zone では
**末尾 2 つを P4 に統合**する（上表の `+` の部分）。
encounter の `id` 昇順がそのまま層の順序になっている。

`Zone.partitions[].default` が FFLogs UI の既定パーティション。

---

## 9. ジョブ（spec）一覧

```graphql
gameData { classes { id name slug specs { id name slug } } }
```

FF14 はクラスが 1 つ（`Global`）で、その下に 21 ジョブが spec として並ぶ。
`specName`（API に渡す値）は下表の slug 列。

| specId | name / slug | specId | name / slug |
| --- | --- | --- | --- |
| 1 | Astrologian | 12 | Warrior |
| 2 | Bard | 13 | WhiteMage |
| 3 | BlackMage | 14 | RedMage |
| 4 | DarkKnight | 15 | Samurai |
| 5 | Dragoon | 16 | Dancer |
| 6 | Machinist | 17 | Gunbreaker |
| 7 | Monk | 18 | Reaper |
| 8 | Ninja | 19 | Sage |
| 9 | Paladin | 20 | Viper |
| 10 | Scholar | 21 | Pictomancer |
| 11 | Summoner | | |

→ `src/lib/jobs/jobs.ts` の `JOBS` がこの実データと一致している（テストで検証）。

補足: `gameData` に `specs` フィールドは無い（`gameData.classes[].specs` 経由でのみ取得できる）。

---

## 10. Report（参考）

```graphql
reportData { report(code: "…") { title fights(killType: Kills) { id name encounterID kill difficulty } } }
```

* `report.fights(killType: Kills)` で kill だけを列挙できる。
* `masterData { actors { id name type subType server } }` で、その Report に参加した
  実在キャラクター名と World、そのときのジョブ（`subType`）が取れる。
  本アプリの動作確認用の実データ収集に使った。

---

## 11. World

```graphql
worldData { regions { id name slug servers(limit: 500) { data { name slug } } } }
worldData { region(id: 3) { … } }   # 3 = Japan
```

実測（2026-10）で **125 ワールド / 6 リージョン**:

| region | 数 |
| --- | --- |
| NA | 36 |
| EU | 16 |
| JP | 32 |
| OC | 5 |
| CN | 31 |
| KR | 5 |

`Region.servers` の引数は `limit` / `page`（`per_page` ではない）。

**このクエリは実測 31.3 points かかる。** ワールドは拡張時にしか増えないため、
`npm run fetch:worlds` で `src/lib/parser/worlds.generated.ts` に静的に書き出し、
実行時は API を叩かない（`WORLD_INDEX_REFRESH=1` のときだけ取り直す）。
これがないとコールドスタートのたびに 31 points を失う。

---

## 12. ボトルネックの実測

キャッシュが空のときの内訳（8 人ぶん、うち 4 人が World 無し）。`Server-Timing` と構造化ログで計測。

| 区間 | 所要時間 | 備考 |
| --- | --- | --- |
| Lodestone 検索 × 4（並列） | **約 960ms** | 1 件あたり 0.7〜0.9 秒。**最大のボトルネック** |
| FFLogs キャラクター特定（1 リクエストに集約） | 約 200ms | 1 件ずつだと 200ms × 人数 |
| FFLogs 候補の実在確認（1 リクエスト） | 約 200ms | |
| 合計（キャッシュ空） | **約 1.2 秒** | 改善前は逐次実行で 4.0 秒 |
| 合計（キャッシュ済み） | **約 2〜6ms** | 1 往復も発生しない |

重要なのは **FFLogs ではなく Lodestone のほうが遅い**という点。
FFLogs は 1 リクエスト 200ms 程度で、alias でまとめれば人数分の往復は消せる。
Lodestone は 1 検索 0.7〜0.9 秒かかり、これは短縮できないため
「一度引いたら長く保存する」（`fflogs:nameindex` / `fflogs:lodestone`）で対処している。

## 13. 判明した「できないこと」まとめ

| やりたいこと | 可否 | 理由 / 代替 |
| --- | --- | --- |
| 名前だけでキャラ検索 | ✗ | 検索 API が無い。World + Region が必須 |
| 1 リクエストで 8 人 × 6 Tier | ○（レイテンシ面） | alias で可能。ただし points は alias 数に比例して増える |
| クエリでコストを絞る | ✗ | JSON スカラーは部分選択できない |
| 層ごとの「平均 Perf」 | △ | `zoneRankings` には無い（Median のみ）。`encounterRankings.averagePerformance` は 1 層 1 リクエスト |
| Active を character API から | ✗ | 存在しない。`report.table(DamageDone).entries[].activeTime` |
| 古い Report の Active | ✗ | アーカイブ済みは購読者用 `/user` エンドポイントのみ |
| 安価な「他ジョブのログ有無」 | △ | 専用 API は無い。`zoneRankings(specName)` をジョブ数ぶん並べる（本アプリは遅延実行） |
| MT/ST のログ上判定 | ✗ | 仕様どおり MVP では実装しない |
