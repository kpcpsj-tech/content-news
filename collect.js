// Bing 뉴스에서 최근 14일 기사를 모아 articles.json에 넣는 스크립트 (index.html이 이 파일을 읽음)
// 실행: node collect.js   (GitHub에서는 30분마다, 내 컴퓨터에서는 serve.js가 30분마다 자동으로 실행함)
const fs = require("fs");
const path = require("path");

const JSON_OUT = path.join(__dirname, "articles.json");
const CACHE = path.join(__dirname, ".news-cache.json"); // 이미 찾아 둔 사진
const DAYS = 14;
const PER_GROUP = 8;   // 분야 × 나라마다 넣을 기사 수
const MAX_TRY = 24;    // 사진을 찾으려고 살펴볼 최대 기사 수 (분야 × 나라마다)
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" };

// 분야 → 나라 → [검색어, Bing 지역]. "중국"은 Bing에 중국 본토 판이 없어 홍콩·대만 판(중국어)으로 모음
const FEEDS = {
  drama: {
    kr:  [["K-드라마", "ko-KR"], ["한국 드라마", "ko-KR"], ["OTT 드라마", "ko-KR"], ["넷플릭스 드라마", "ko-KR"]],
    us:  [["K-drama", "en-US"], ["Korean drama", "en-US"]],
    jp:  [["韓国ドラマ", "ja-JP"]],
    cn:  [["韩剧", "zh-HK"], ["韓劇", "zh-HK"], ["韓劇", "zh-TW"]],
    sea: [["K-drama", "en-SG"], ["K-drama", "en-PH"], ["K-drama", "en-MY"], ["K-drama", "en-ID"], ["phim Hàn", "vi-VN"], ["ซีรีส์เกาหลี", "th-TH"]]
  },
  music: {
    kr:  [["케이팝", "ko-KR"], ["K팝", "ko-KR"], ["아이돌 컴백", "ko-KR"]],
    us:  [["K-pop", "en-US"]],
    jp:  [["K-POP", "ja-JP"]],
    cn:  [["K-pop", "zh-HK"], ["K-pop", "zh-TW"]],
    sea: [["K-pop", "en-SG"], ["K-pop", "en-PH"], ["K-pop", "en-MY"], ["K-pop", "en-ID"], ["K-pop", "vi-VN"], ["K-pop", "th-TH"]]
  }
};
// 검색어마다 결과 두 쪽(1~10번째, 11~20번째)을 받음
const feedUrls = (pairs) => pairs.flatMap(([q, mkt]) => [1, 11].map((first) =>
  "https://www.bing.com/news/search?q=" + encodeURIComponent(q) + `&format=rss&setmkt=${mkt}&first=${first}`));

// 제목에 분야와 관련된 말이 있어야 넣음
const RELEVANT = {
  drama: /드라마|OTT|넷플릭스|drama|ドラマ|韩剧|韓劇|电视剧|電視劇|phim|ซีรีส์|netflix/i,
  music: /케이팝|K팝|K-?pop|아이돌|idol|アイドル|偶像|音源|BTS|블랙핑크|blackpink/i
};
// 기사가 아닌 것(스팸, 다시보기 사이트, SNS 글) 걸러내기
const BLOCK_TITLE = /#|在线看|在线观看|全集|高清|免费|成人|카지노|슬롯|토토|베팅|무료 사이트|casino|slot|betting/i;
const BLOCK_OUTLET = /^(TVer|Facebook|YouTube|Instagram|TikTok|X|note|Threads)$/i;

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ""; };

function parse(xml) {
  return xml.split("<item>").slice(1).map((item) => {
    const link = tag(item, "link");
    const url = link.includes("bing.com/news/apiclick") ? new URL(link).searchParams.get("url") || link : link; // Bing 중간 주소 대신 원문 주소
    return {
      title: tag(item, "title"),
      url,
      outlet: tag(item, "News:Source"),
      thumb: tag(item, "News:Image").replace(/^http:/, "https:"),
      time: Date.parse(tag(item, "pubDate"))
    };
  }).filter((a) => a.title && a.url && a.outlet && a.time);
}

const get = (url, opts = {}) => fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(10000), ...opts });

async function fetchFeed(url) {
  try {
    const res = await get(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return parse(await res.text());
  } catch (e) {
    console.warn("  받기 실패:", url.slice(0, 80), e.message);
    return [];
  }
}

// 원문 기사의 대표 사진(og:image / twitter:image) 찾기
async function findImage(url) {
  const res = await get(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const html = (await res.text()).slice(0, 400000);
  for (const meta of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/(?:property|name)\s*=\s*["'](?:og:image(?::url|:secure_url)?|twitter:image(?::src)?)["']/i.test(meta)) continue;
    const content = meta.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) return new URL(decode(content), url).href.replace(/^http:/, "https:");
  }
  return "";
}

// 사진 주소가 실제로 열리는지 확인
async function isImage(src) {
  try {
    const res = await get(src, { headers: { ...UA, Accept: "image/*" } });
    const ok = res.ok && (res.headers.get("content-type") || "").startsWith("image/");
    res.body?.cancel();
    return ok;
  } catch { return false; }
}

// 원문 사진 → 없으면 Bing 작은 사진. 사진을 못 찾으면 null
async function withPhoto(a, cache) {
  if (!(a.url in cache)) {
    let image = "";
    try { image = await findImage(a.url); } catch { /* 원문을 못 열면 Bing 사진으로 대신함 */ }
    if (image && !(await isImage(image))) image = "";
    if (!image && a.thumb && (await isImage(a.thumb))) image = a.thumb;
    cache[a.url] = image;
  }
  return cache[a.url] ? { ...a, image: cache[a.url] } : null;
}

const kstDate = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const sameTitle = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 24); // 앞부분이 같으면 같은 기사로 봄

async function collect() {
  const since = Date.now() - DAYS * 86400e3;
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { /* 처음 실행 */ }
  const seen = new Set();
  const picked = [];

  for (const [cat, byCountry] of Object.entries(FEEDS)) {
    for (const [country, pairs] of Object.entries(byCountry)) {
      const candidates = (await Promise.all(feedUrls(pairs).map(fetchFeed))).flat()
        .filter((a) => a.time >= since && RELEVANT[cat].test(a.title) && !BLOCK_TITLE.test(a.title) && !BLOCK_OUTLET.test(a.outlet))
        .sort((a, b) => b.time - a.time)
        .filter((a) => { const k = sameTitle(a.title); if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, MAX_TRY);
      const found = [];
      for (let i = 0; i < candidates.length && found.length < PER_GROUP; i += 4) {
        const batch = await Promise.all(candidates.slice(i, i + 4).map((a) => withPhoto(a, cache)));
        found.push(...batch.filter(Boolean));
      }
      found.slice(0, PER_GROUP).forEach((a) => picked.push({ cat, country, ...a }));
      console.log(`${cat} / ${country}: ${Math.min(found.length, PER_GROUP)}건`);
    }
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));

  // 오래된 기사부터 번호를 매겨, 같은 날짜 안에서도 최신 기사가 앞에 오게 함
  picked.sort((a, b) => a.time - b.time);
  const articles = picked.map((a, i) => ({ id: i + 1, cat: a.cat, country: a.country, date: kstDate(a.time), outlet: a.outlet, title: a.title, url: a.url, image: a.image }));
  const collectedAt = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

  fs.writeFileSync(JSON_OUT, JSON.stringify({ collectedAt, articles }, null, 1));
  console.log(`총 ${articles.length}건을 넣었습니다. (${collectedAt} 기준)`);
}

module.exports = { collect };
if (require.main === module) collect();
