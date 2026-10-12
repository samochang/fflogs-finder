import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeEntities,
  extractBodyText,
  extractElementByClass,
  extractTitle,
  htmlToText,
  isAllowedUrl,
  parseSingleUrl,
} from "../src/lib/parser/fetchUrl.ts";

describe("URL 入力の判定", () => {
  it("入力全体が https の URL 1 つのときだけ URL とみなす", () => {
    assert.equal(parseSingleUrl("https://jp.finalfantasyxiv.com/lodestone/character/1/blog/2/"), "https://jp.finalfantasyxiv.com/lodestone/character/1/blog/2/");
    assert.equal(parseSingleUrl("  https://example.com/a  "), "https://example.com/a");
    assert.equal(parseSingleUrl("MT Alice Vale\nhttps://example.com/a"), undefined);
    assert.equal(parseSingleUrl("http://example.com/a"), undefined);
    assert.equal(parseSingleUrl("MT Alice Vale"), undefined);
  });

  it("allowlist 外のホストを拒否する（SSRF 対策）", () => {
    assert.equal(isAllowedUrl("https://jp.finalfantasyxiv.com/lodestone/"), true);
    assert.equal(isAllowedUrl("https://na.finalfantasyxiv.com/lodestone/"), true);
    assert.equal(isAllowedUrl("https://finalfantasyxiv.com/"), true);
    assert.equal(isAllowedUrl("https://evil.example.com/"), false);
    // 部分一致でのすり抜けを防ぐ
    assert.equal(isAllowedUrl("https://finalfantasyxiv.com.evil.test/"), false);
    assert.equal(isAllowedUrl("https://127.0.0.1/"), false);
    assert.equal(isAllowedUrl("https://localhost/"), false);
    assert.equal(isAllowedUrl("http://jp.finalfantasyxiv.com/"), false);
  });
});

describe("HTML → テキスト", () => {
  it("script / style を除去し、br とブロック境界を改行にする", () => {
    const html = `<div><script>var a=1;</script><p>1行目</p>2行目<br />3行目<style>.a{}</style></div>`;
    assert.equal(htmlToText(html), "1行目\n2行目\n3行目");
  });

  it("実体参照をデコードする", () => {
    assert.equal(decodeEntities("A&amp;B &lt;tag&gt; &quot;q&quot; &#65; &#x42; &nbsp;"), "A&B <tag> \"q\" A B  ");
  });

  it("title を取得する", () => {
    assert.equal(extractTitle("<html><head><title>募集 &amp; 固定</title></head></html>"), "募集 & 固定");
  });

  it("入れ子のある要素を正しく切り出す", () => {
    const html = `<div class="txt_selfintroduction">A<div>B</div>C</div><div>D</div>`;
    assert.equal(extractElementByClass(html, "txt_selfintroduction"), "A<div>B</div>C");
    assert.equal(htmlToText(extractElementByClass(html, "txt_selfintroduction")!), "A\nB\nC");
  });

  it("Lodestone の日記本文クラスを優先して本文を取る", () => {
    const html = `
      <html><head><title>t</title></head>
      <body>
        <div class="nav">ナビ</div>
        <div class="blog__area"><div class="txt_selfintroduction">MT Alice Vale / GNB<br />D1 Bob Stone / WHM</div></div>
        <div class="footer">フッタ</div>
      </body></html>`;
    assert.equal(extractBodyText(html), "MT Alice Vale / GNB\nD1 Bob Stone / WHM");
  });

  it("本文クラスが無ければ main を使う", () => {
    const html = `<html><body><header>h</header><main>MT Alice Vale</main><footer>f</footer></body></html>`;
    assert.equal(extractBodyText(html), "MT Alice Vale");
  });
});
