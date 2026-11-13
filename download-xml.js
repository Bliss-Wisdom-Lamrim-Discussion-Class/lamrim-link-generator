#!/usr/bin/env node
// 下載 https://lamrim.xyz/player/pb/gPlayerSimLinkCreater.html 各音檔類別的 XML 文字稿
//
// 用法：
//   node download-xml.js -l                 列出音檔類別 1~4
//   node download-xml.js -l -t <類別>        列出該類別的起始音檔與結束音檔
//   node download-xml.js -t <類別> [-s <起始音檔>] [-e <結束音檔>]
//                                           下載 XML，-s / -e 省略時從第一個音檔下載到最後一個

const fs = require('fs');
const path = require('path');

const SCRIPT_BASE = 'https://lamrim.xyz/player/script/';
const OUT_ROOT = path.join(process.cwd(), 'xml');

// 編號照連結產生器「音檔類別」下拉選單的順序
// sided: 音檔 ID 是「卷號 + a/b 面」（例如 12a）；否則只有編號（例如 5）
const TEACHINGS = {
  1: { key: 'gl1', name: '廣論-南普陀版', sided: true, pad: 3 },
  2: { key: 'ggl2', name: '全球廣論-II', noXml: true },
  3: { key: 'gl2', name: '廣論-鳳山寺版', sided: false, pad: 2 },
  4: { key: 'nv1', name: '南山律在家備覽', sided: true, pad: 3 },
};

function parseArgs(argv) {
  const args = { list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-l') args.list = true;
    else if (a === '-t' || a === '-s' || a === '-e') {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} 後面要接一個值`);
      args[a.slice(1)] = v;
    } else throw new Error(`不認得的參數：${a}`);
  }
  return args;
}

function getTeaching(t) {
  const tch = TEACHINGS[t];
  if (!tch) throw new Error(`音檔類別要填 1~4，收到：${t}`);
  if (tch.noXml) throw new Error(`${t}. ${tch.name} 的文字稿不是 lamrim.xyz 上的 XML 檔，這支程式不下載`);
  return tch;
}

// 音檔 ID 與 { num, side } 互換
function parseId(tch, id) {
  const m = tch.sided ? /^(\d+)([ab])$/i.exec(id) : /^(\d+)$/.exec(id);
  if (!m) throw new Error(`音檔格式錯誤：${id}（${tch.name} 的格式是 ${tch.sided ? '卷號加 a/b，例如 12a' : '編號，例如 5'}）`);
  return { num: parseInt(m[1], 10), side: tch.sided ? m[2].toLowerCase() : '' };
}

function formatId(tch, { num, side }) {
  return tch.sided ? `${num}${side}` : `${num}`;
}

function fileName(tch, { num, side }) {
  return `${String(num).padStart(tch.pad, '0')}${side}.xml`;
}

function fileUrl(tch, id) {
  return `${SCRIPT_BASE}${tch.key}/${fileName(tch, id)}`;
}

async function exists(url) {
  const res = await fetch(url, { method: 'HEAD' });
  return res.status === 200;
}

// 用 HEAD request 二分搜尋找出最後一個存在的編號
async function findRange(tch) {
  const firstSide = tch.sided ? 'a' : '';
  const first = { num: 1, side: firstSide };
  if (!(await exists(fileUrl(tch, first)))) throw new Error(`找不到第一個音檔：${fileUrl(tch, first)}`);
  let lo = 1;
  let hi = 2;
  while (await exists(fileUrl(tch, { num: hi, side: firstSide }))) {
    lo = hi;
    hi *= 2;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(fileUrl(tch, { num: mid, side: firstSide }))) lo = mid;
    else hi = mid;
  }
  let last = { num: lo, side: firstSide };
  if (tch.sided && (await exists(fileUrl(tch, { num: lo, side: 'b' })))) last = { num: lo, side: 'b' };
  return { first, last };
}

function* idsBetween(tch, from, to) {
  let cur = { ...from };
  const order = (id) => id.num * 2 + (id.side === 'b' ? 1 : 0);
  while (order(cur) <= order(to)) {
    yield cur;
    if (!tch.sided) cur = { num: cur.num + 1, side: '' };
    else if (cur.side === 'a') cur = { num: cur.num, side: 'b' };
    else cur = { num: cur.num + 1, side: 'a' };
  }
}

async function download(tch, from, to) {
  const outDir = path.join(OUT_ROOT, tch.key);
  fs.mkdirSync(outDir, { recursive: true });
  let ok = 0;
  const failed = [];
  for (const id of idsBetween(tch, from, to)) {
    const url = fileUrl(tch, id);
    const res = await fetch(url);
    if (res.status !== 200) {
      failed.push(`${formatId(tch, id)}（HTTP ${res.status}）`);
      console.log(`失敗 ${url} HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(outDir, fileName(tch, id)), buf);
    ok++;
    console.log(`下載 ${url} → ${path.join(outDir, fileName(tch, id))}（${buf.length} bytes）`);
  }
  console.log(`完成：成功 ${ok} 個，失敗 ${failed.length} 個${failed.length ? '：' + failed.join('、') : ''}`);
  if (failed.length) process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list && args.t === undefined) {
    for (const [n, tch] of Object.entries(TEACHINGS)) {
      console.log(`${n}. ${tch.name}（${tch.key}）${tch.noXml ? '　沒有 XML 檔' : ''}`);
    }
    return;
  }

  if (args.t === undefined) throw new Error('要指定 -l 或 -t <類別>');
  const tch = getTeaching(args.t);

  if (args.list) {
    const { first, last } = await findRange(tch);
    console.log(`${args.t}. ${tch.name}`);
    console.log(`起始音檔：${formatId(tch, first)}`);
    console.log(`結束音檔：${formatId(tch, last)}`);
    return;
  }

  let from = args.s !== undefined ? parseId(tch, args.s) : null;
  let to = args.e !== undefined ? parseId(tch, args.e) : null;
  if (!from || !to) {
    const range = await findRange(tch);
    from = from || range.first;
    to = to || range.last;
  }
  if (from.num * 2 + (from.side === 'b') > to.num * 2 + (to.side === 'b')) {
    throw new Error(`起始音檔 ${formatId(tch, from)} 在結束音檔 ${formatId(tch, to)} 之後`);
  }
  await download(tch, from, to);
}

main().catch((err) => {
  console.error(`錯誤：${err.message}`);
  process.exitCode = 1;
});
