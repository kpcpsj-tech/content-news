// index.html을 http://localhost:8000 에서 보여 주고, 30분마다 새 기사를 모으는 로컬 서버 (내 컴퓨터에서 미리 볼 때 사용)
// 이 컴퓨터에서만 접속됨(127.0.0.1). 같은 와이파이의 다른 기기는 secrets.js를 가져갈 수 없음
const http = require("http");
const fs = require("fs");
const path = require("path");
const { collect } = require("./collect");

const PORT = 8000;
const EVERY = 30 * 60 * 1000;
const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/articles.json": ["articles.json", "application/json; charset=utf-8"],
  "/secrets.js": ["secrets.js", "text/javascript; charset=utf-8"]
};

let running = false;
async function update() {
  if (running) return;
  running = true;
  try { await collect(); } catch (e) { console.error("수집 실패:", e.message); }
  running = false;
}

http.createServer((req, res) => {
  const file = FILES[req.url.split("?")[0]];
  if (!file) { res.writeHead(404); res.end(); return; }
  fs.readFile(path.join(__dirname, file[0]), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`http://localhost:${PORT} 에서 실행 중 (30분마다 새 기사 수집)`);
  update();
  setInterval(update, EVERY);
});
