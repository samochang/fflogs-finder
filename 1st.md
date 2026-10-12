# FFLogs固定募集メンバー比較ツール MVP仕様

## 1. 目的

FF14の固定募集文を入力すると、募集文から最大8人のキャラクターを抽出し、各キャラクターについて過去の零式Tierの各層におけるFFLogs成績を横並びで比較できるWebアプリ。

主用途は「固定募集で応募してきたメンバーの過去実績を素早く比較すること」。

特に、

* 募集時の担当ジョブを基準に表示
* 過去6つ程度の零式Tierを一覧比較
* 各層のBest Perf / Avg Perf / Kills / Activeを確認
* 同一キャラクターが複数ジョブでログを持っている場合は、他ジョブへ切り替えて確認
* 日本語圏の固定募集で一般的なジョブ略称・俗称を認識

をMVPの中心機能とする。

大規模サービス化は前提とせず、低コストなサーバレス構成で開始する。

---

# 2. 技術構成

* Next.js
* Vercel
* Upstash Redis
* FFLogs v2 GraphQL API
* TypeScript

初期はPostgreSQLを導入しない。

FFLogsから再取得可能なデータをRedisにキャッシュして使用する。

---

# 3. 入力画面

大きなtextareaを基本とする。

初期状態では1行程度のコンパクトな入力欄でもよい。

### 入力方法

#### A. テキスト貼り付け

固定募集文をそのまま貼り付ける。

例：

```text
MT ○○○○
ST △△△△
H1 □□□□
H2 ××××
D1 AAAA
D2 BBBB
D3 CCCC
D4 DDDD

募集条件：
零式6週目
過去絶経験者
etc...
```

#### B. Lodestone URL貼り付け

Lodestoneの日記や募集関連ページなど、本文を取得可能なURLが入力された場合は本文を取得してparserに渡す。

URL入力時は、可能なら本文抽出後に通常のテキストparserと同一処理へ流す。

URL取得に失敗した場合は通常のテキスト貼り付けへ誘導する。

---

# 4. 募集文parser

## 4.1 抽出対象

募集文から可能な範囲で以下を抽出する。

* キャラクター名
* World（記載されている場合）
* 募集ジョブ
* 募集ロール / ポジション（記載されている場合）

---

## 4.2 基本方針

完全な自然言語解析は行わない。

日本語圏のFF14固定募集で実際によく使われる、

* 1文字略称
* 数文字略称
* 漢字1文字
* 俗称
* ジョブアイコン
* 英略称

などを正規化する辞書を持つ。

特に**日本語圏で一般的な表記を主軸**とし、WAR / GNB / RPR等の英略称は補助的に認識する。

内部ではすべてFFLogs側のジョブIDへ正規化する。

---

# 5. ジョブ表記の正規化

内部では例えば、

```ts
type JobId =
  | "paladin"
  | "warrior"
  | "darkKnight"
  | "gunbreaker"
  | ...
```

のような正規化されたIDを使用する。

入力時の表記は複数候補を許容する。

## 5.1 例

### タンク

```text
ナ
ナイト
PLD

戦
戦士
WAR

暗
暗黒
暗黒騎士
暗黒
DRK

ガ
ガンブレ
ガンブレイカー
GNB
```

### ヒーラー

```text
白
白魔
白魔道士
WHM

学
学者
SCH

占
占星
占星術師
AST

賢
賢者
SAG
```

### 近接DPS

```text
モ
モンク
MNK

竜
竜騎士
DRG

忍
忍者
NIN

侍
SAM

リ
鎌
リーパー
RPR

ヴァ
ヴァイパー
VPR
```

### 遠隔物理DPS

```text
詩
詩人
吟遊
吟遊詩人
BRD

機
機工
機工士
MCH

踊
踊り子
DNC
```

### キャスター

```text
黒
黒魔
黒魔道士
BLM

召
召喚
召喚士
SMN

赤
赤魔
赤魔道士
RDM

ピ
筆
ピクト
ピクトマンサー
PCT
```

実装時にはジョブごとのalias辞書を独立させ、後から表記ゆれを追加しやすくする。

例：

```ts
const jobAliases = {
  reaper: ["リ", "鎌", "リーパー", "RPR"],
  pictomancer: ["ピ", "筆", "ピクト", "ピクトマンサー", "PCT"],
  ...
};
```

---

# 6. 短い表記の誤認識対策

1文字略称は通常の文章にも出現するため、単純な全文検索は禁止。

例えば、

```text
赤
```

を文章中に見つけただけで「赤魔」と解釈してはいけない。

以下のような**募集枠らしい構造**を優先する。

```text
赤 ○○○○
ピ △△△△
鎌 □□□□
```

```text
D4 赤 ○○○○
```

```text
○○○○ 赤
```

など。

また、

* 行頭
* ロール番号
* MT/ST/H1/H2/D1～D4等の近接情報
* キャラクター名らしい文字列
* World表記

などを組み合わせて判定する。

誤認識しやすいaliasはconfidenceを低くして、確定不能ならユーザーに確認させる設計も許容する。

---

# 7. ジョブアイコン入力

募集文にジョブアイコンを含む形式が取得できる場合、アイコン情報もジョブ判定に利用する。

内部ではテキスト表記と同じFFLogsジョブIDへ正規化する。

UIでは、認識した募集ジョブを**FF14のジョブアイコンで表示**する。

例えば、

```text
「鎌」
```

と書かれていても、

```text
[リーパーアイコン] キャラクター名
```

と表示する。

---

# 8. 募集文parserの優先順位

ジョブ判定は概ね以下の優先順位とする。

```text
1. 明示的なジョブアイコン
2. 明確なジョブ名
3. 日本語略称・俗称
4. 英略称
5. 文脈から推定
```

ただし推定のみで確定させる場合は、UI上で確定状態と曖昧状態を区別できるようにする。

---

# 9. キャラクター情報と募集情報を分離して保持

内部データでは、

```ts
{
  character: {
    canonicalId: ...,
    name: ...,
    world: ...
  },

  recruitment: {
    job: "gunbreaker",
    role: "tank",
    position: "ST"
  }
}
```

のように分離する。

重要：

**「募集で指定されたジョブ」と「そのキャラクターの得意ジョブ / メインジョブ」は別概念として扱う。**

システム側でメインジョブを推定して1つに決めない。

---

# 10. MT / ST / H1 / H2 / D1～D4

募集文に記載されている場合は保持して表示してよい。

ただしMVPでは、実際のFFLogsログから、

* MTだった
* STだった
* H1だった
* H2だった

等を正確に判定しない。

特にMT/STは、同じジョブでもログごとに役割が変わり得るため、ランキング取得条件には使わない。

ランキング取得の基準は**募集ジョブ**。

例：

```text
募集：ST ガンブレ
```

なら、

```text
FFLogs → ガンブレイカーの成績を取得
```

とする。

「STとしての成績」とは断定しない。

パッチやジョブ構成からST/MTを推定できる場合があっても、MVPでは正確なログ上のポジション判定機能を実装しない。

---

# 11. FFLogsキャラクター特定

FFLogs上でキャラクターを特定し、可能なら`canonicalID`を取得する。

以降の内部識別にはcanonicalIDを使う。

検索には可能なら、

* Character name
* World
* Region

を利用する。

Worldがない、または候補が複数ある場合は候補選択UIを出す。

---

# 12. 対象コンテンツ

MVPでは**直近6つのSavage raid tier**を対象とする。

1 Tier = 4層。

例：

```text
拡張X
 ├─ Tier 1
 ├─ Tier 2
 └─ Tier 3

拡張Y
 ├─ Tier 1
 ├─ Tier 2
 └─ Tier 3
```

新しい拡張が始まっても、「最新6 Tier」という考え方で更新可能にする。

次の大型拡張の1st raid tierを見る場合は、直近6 Tierとして前拡張3Tier + 新拡張3Tier程度が対象になる想定。

レイドIDはハードコードしすぎず、設定またはFFLogs側のzone情報から管理できる構造にする。

---

# 13. データ量

1キャラクター：

```text
6 Tier × 4層 = 24 encounters
```

8人：

```text
24 × 8 = 192 encounter slots
```

ジョブを複数保持する場合は、

```text
Character × Job × Tier × Encounter
```

としてデータが増える。

ただし初期表示では募集ジョブを優先する。

---

# 14. 各層で取得するデータ

各、

```text
Character
× Job
× Tier
× Encounter
```

について以下を取得する。

### 必須

* Best Perf
* Avg Perf
* Kills / Clear Count
* Active

### Active

MVPではFFLogsが提供している既存のActive値をそのまま利用する。

戦闘イベントを全部取得して独自に「本当のアクティブ率」を計算しない。

GCD uptimeもMVPでは計算しない。

---

# 15. Avg / Bestの定義

Avgは自前計算しない。

FFLogsキャラクターページ / ランキングで表示されるものと同一の意味になるAPIフィールドを特定して取得する。

「直近5回平均」など独自定義にはしない。

実装時に、

1. GraphQL schema確認
2. APIレスポンス確認
3. 実際のFFLogsキャラクターページとの照合

を行い、正確なフィールドを確定する。

---

# 16. Activeの扱い

ActiveはFFLogs提供値をそのまま表示する。

UI上では、

```text
Active 98%
```

などと表示する。

「GCD uptime」とは表記しない。

将来、

```text
Best Perfのfight
↓
Report event取得
↓
GCD解析
↓
GCD uptime
```

を追加する可能性はあるが、MVPでは実装しない。

---

# 17. 比較画面

基本構造：

```text
                   天獄            煉獄            黄金
               P1 P2 P3 P4     P1 P2 P3 P4     P1 P2 P3 P4

[GNB] AAAAA    98 95 91 97    94 91 96 90    97 93 95 99
[GNB] BBBBB    87 91 85 94    88 89 91 93    91 90 87 92
[忍]  CCCCC    93 90 95 91    92 87 94 96    95 93 91 94
...
```

1セルには、

```text
Best
Avg
Kills
Active
```

を表示できるようにする。

情報量が多いため、通常時はコンパクト表示し、hover / click等で詳細を見せるUIも検討する。

---

# 18. 募集ジョブの表示

各キャラクター行の先頭には、募集文から認識したジョブアイコンを表示する。

例：

```text
[ガンブレイカーアイコン] AAAAA
```

必要ならその横に、

```text
ST
```

など募集文から抽出したポジションを表示する。

ただし、そのジョブが実際にログ上でMT/STのどちらだったかは断定しない。

---

# 19. 他ジョブUI

全ジョブのログを常時並べない。

初期状態では募集ジョブのみ見える。

例：

```text
[ガンブレイカーアイコン] AAAAA
```

そのジョブアイコンはクリック可能なインタラクティブUIとする。

クリックすると、そのキャラクターにログが存在する他ジョブのアイコンが展開される。

例：

```text
          [GNB]
        ↙   ↓   ↘
      [WAR][DRK][PLD]
```

またはポップオーバー等。

「他ジョブにもログがあります」のような文字列で説明しない。

---

# 20. 他ジョブの候補

そのキャラクターに実際に該当ジョブのログが存在する場合だけ切替候補として表示する。

例：

```text
募集ジョブ：GNB
ログあり：GNB / WAR / DRK
```

なら、

```text
[GNB]
```

を主表示し、操作時にWAR / DRKを選択可能にする。

---

# 21. ジョブ切替の動作

ジョブを切り替えた場合、

**そのキャラクターの行だけを対象ジョブの成績に切り替える。**

例：

```text
Aさん [GNB]
P1 95 / P2 91 / P3 98 / P4 94
```

↓

WARアイコンを押す

```text
Aさん [WAR]
P1 87 / P2 93 / P3 90 / P4 96
```

比較表全体を別画面に遷移させない。

---

# 22. 初回取得時のジョブ優先順位

最初に取得するのは基本的に募集ジョブ。

他ジョブについては、

* 初回から取得する
* 他ジョブUIを操作した時に遅延取得する

のどちらでもよい。

API pointsを節約できるなら、**他ジョブは遅延取得を優先**する。

ただし「そのキャラに他ジョブのログが存在する」ことを安価に判定できる場合は、その情報を利用する。

---

# 23. Perfの色

FFLogsの一般的なparse colorに合わせる。

```text
gray
green
blue
purple
orange
pink
gold
```

等。

Perf値と色を連動させる。

---

# 24. GraphQL取得方針

HTTP requestを、

```text
1層 = 1 request
1 Tier = 1 request
```

に分割しない。

GraphQL alias等を利用し、

```text
character A
  tier1
  tier2
  ...
  tier6

character B
  tier1
  tier2
  ...
  tier6

...
```

という構造を、可能な限り少ないHTTP requestで取得する。

概念：

```graphql
a: character(...) {
  tier1: zoneRankings(zoneID: ...)
  tier2: zoneRankings(zoneID: ...)
}

b: character(...) {
  tier1: zoneRankings(zoneID: ...)
  tier2: zoneRankings(zoneID: ...)
}
```

4層を4つのHTTP requestに分けない。

ただし、

**「巨大な1 query = API pointsも最小」とは仮定しない。**

---

# 25. API pointsの実測

FFLogs APIのrate limit情報を取得し、実際のpoints消費量を測定する。

```graphql
rateLimitData {
  limitPerHour
  pointsSpentThisHour
  pointsResetIn
}
```

最低限以下を実測：

```text
A. 1 character × 1 Tier
B. 1 character × 3 Tier
C. 1 character × 6 Tier
D. 8 character × 6 Tier
```

さらに、

```text
last-update確認用query
```

を作れるなら、そのpoints消費量も測定する。

目的：

```text
全部取得
vs
last-updateを先に確認 → 変更Tierだけ再取得
```

のどちらが効率的かを判断する。

---

# 26. キャッシュ方針

14日TTLなどの短い有効期限は主要な制御に使わない。

FFLogsへ問い合わせれば最新データを確認できるため、キャッシュデータそのものは長期間保持してよい。

Redisから消えた場合はFFLogsから再取得する。

重要なのは、

**キャッシュTTLではなく、FFLogsへの更新問い合わせ頻度を制御すること。**

---

# 27. 更新ボタン

結果画面に、

```text
[最新データを確認]
```

を設置する。

通常のページ表示ではFFLogs APIへアクセスしない。

更新ボタンを押した場合のみFFLogs APIへ問い合わせる。

---

# 28. 更新連打・過密アクセス対策

Redisでrefresh lockを実装する。

例：

```text
refresh:{canonicalID}:{job}
```

または問い合わせ単位のhash。

RedisのNX + EX等を利用し、短時間だけ同一対象の更新処理を1本に制限する。

例：

```text
60秒
```

など。

同一キャラクター・同一ジョブを複数ユーザーが同時更新した場合、同時に複数のFFLogs requestを発生させない。

---

# 29. 差分更新

将来的な最適化候補。

理想：

```text
Tier 1 last push
Tier 2 last push
Tier 3 last push
...
```

を軽量に取得し、

```text
前回確認時より更新されたTier
```

だけ再取得する。

ただしMVPでは必須機能にしない。

まず、

```text
8人 × 6Tier
```

をまとめて取得した場合のAPI pointsを実測する。

その結果、last push方式が明確に有利なら導入する。

---

# 30. Redisデータ構造

MVPでは「1 character = 1 document」に寄せる。

例：

```text
character:{canonicalID}
```

```json
{
  "canonicalId": 123456,
  "name": "Example Character",
  "world": "Example World",
  "hidden": false,

  "jobs": {
    "gunbreaker": {
      "tiers": {
        "zone1": {
          "p1": {},
          "p2": {},
          "p3": {},
          "p4": {}
        },
        "zone2": {}
      },
      "fetchedAt": "..."
    },

    "warrior": {
      "tiers": {}
    }
  }
}
```

重要なのは、

**Character → Job → Tier → Encounter**

という構造で、複数ジョブを混同しないこと。

---

# 31. 募集情報の一時データ

比較画面では、

```ts
{
  characterId,
  recruitmentJob,
  recruitmentRole,
  recruitmentPosition
}
```

を保持する。

これはFFLogs上のキャラクター情報とは別。

---

# 32. 非公開キャラクター

FFLogs側でランキング非表示になっているキャラクターについては、その設定を尊重する。

非公開の場合：

```text
このキャラクターはFFLogs側でランキング非公開です
```

等を表示する。

非公開情報を別経路から迂回取得しない。

---

# 33. API認証

FFLogs APIのclient secretはブラウザに渡さない。

構成：

```text
Browser
   ↓
Next.js Server
   ↓
FFLogs API
```

環境変数：

```text
FFLOGS_CLIENT_ID
FFLOGS_CLIENT_SECRET
```

---

# 34. エラー処理

### キャラクター特定失敗

```text
キャラクターを特定できませんでした
```

### 同名候補

```text
名前 / World / Region
```

を表示して選択させる。

### API制限

Redisにキャッシュがある場合は古いデータを表示し、

```text
最新データを確認できませんでした
```

等を表示する。

### API timeout

同様に既存キャッシュを優先する。

### hidden

非公開表示。

### ジョブ判定曖昧

推定状態を明示し、必要ならユーザーによる修正を可能にする。

---

# 35. MVPでやらないこと

* PostgreSQL
* ユーザーアカウント
* 恒久的な全履歴DB
* 全ログイベントの保存
* 独自GCD uptime計算
* MT/STのログ上の正確な判定
* All Star分析
* 自動メインジョブ判定
* SNS連携
* 全キャラクターの定期クロール
* 常時全ジョブ表示

---

# 36. 将来拡張候補

## GCD uptime

Best Perfのfightを特定し、Report eventを解析してGCD uptimeを算出。

## 実際のMT/ST推定

パッチ・ジョブ構成・fight情報などから推定。

ただし「推定」であることを明示する。

## 検索履歴

最近比較した固定をRedis等に保存。

## 固定単位の共有URL

```text
/compare/{hash}
```

などで同じ8人の比較画面を共有可能にする。

---

# 37. 実装優先順位

## Phase 1

FFLogs API接続。

## Phase 2

1キャラクター × 1Tier × 1Jobについて、

* Best
* Avg
* Kills
* Active

を取得。

API値とFFLogs UIを照合する。

## Phase 3

1キャラクター × 6Tierに拡張。

## Phase 4

募集ジョブを日本語表記から正規化。

主要aliasを実装する。

## Phase 5

複数ジョブ対応。

```text
募集ジョブ
↓
主表示
↓
ジョブアイコン操作
↓
他ジョブ切替
```

## Phase 6

8キャラクター × 6Tierを可能な限り少ないGraphQL requestにまとめる。

## Phase 7

API points実測。

## Phase 8

Redis cache。

## Phase 9

募集文parserの強化。

## Phase 10

比較UI。

## Phase 11

refresh lock。

---

# 38. 最終的なユーザー体験

```text
固定募集文を貼る
        ↓
8人抽出
        ↓
募集ジョブを日本語表記から判定
        ↓
FFLogsキャラクターを特定
        ↓
比較画面
```

表示例：

```text
                 天獄            煉獄            黄金
             P1 P2 P3 P4     P1 P2 P3 P4     P1 P2 P3 P4

[GNB] AAAAA   98 95 91 97    94 91 96 90    97 93 95 99
[GNB] BBBBB   87 91 85 94    88 89 91 93    91 90 87 92
[忍]  CCCCC   93 90 95 91    92 87 94 96    95 93 91 94
```

日本語の募集表記：

```text
「ガ」
「鎌」
「リ」
「筆」
「ピ」
```

などは内部的に正しいジョブIDへ変換し、UIではジョブアイコンとして表示する。

例えばAさんが、

```text
募集ジョブ：ガンブレ
```

で、

```text
ログあり：ガンブレ / 暗黒 / 戦士
```

なら初期状態：

```text
[ガンブレアイコン] AAAAA
```

ジョブアイコン操作時のみ他ジョブのアイコンを展開する。

他ジョブの成績を常時横並びにはしない。

---

# 39. 開発時の重要ポイント

最優先で確認すること：

1. FFLogs GraphQLからBest Perfを取得する正確なフィールド
2. FFLogs UI上のAvg Perfに対応する正確なフィールド
3. Killsの正確なフィールド
4. Activeの正確なフィールド
5. Job / Spec指定によるランキング取得方法
6. 6Tierを1 queryにまとめられるか
7. 8人×6Tierを1 queryまたは少数queryで取得した場合のAPI points
8. 他ジョブの存在を安価に検出する方法
9. hidden characterの挙動
10. `rateLimitData` の前後差による実測
11. 日本語圏の固定募集で実際に使われるジョブ略称・俗称の追加
12. 曖昧な1文字略称の誤認識をどのように防ぐか

APIスキーマで不明な部分について推測実装せず、実際のquery・responseを確認してから固定する。
