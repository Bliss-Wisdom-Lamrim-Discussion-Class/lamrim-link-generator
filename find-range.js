#!/usr/bin/env node
// 輸入原文的起始文字與結尾文字，找出播放範圍與總時間
//
// 用法：node find-range.js [-s <份數>] <起始文字> <結尾文字>
//   例：node find-range.js 如昔於 人能知
//       node find-range.js -s 3 如昔於 人能知     另外把範圍切成時間相近的 3 份
//
// 讀執行時所在資料夾底下的 bold-gl1-index.json（搜尋用）、bold-gl1.json（時間）、
// mp3-duration-gl1.csv（跨卷時計算總時間用的音檔長度）。
// 文字不必輸入標點符號；文字跨兩段粗體字也找得到。

const fs = require('fs');
const path = require('path');

const bold = JSON.parse(fs.readFileSync(path.resolve('bold-gl1.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.resolve('bold-gl1-index.json'), 'utf8'));

function plainText(s) {
  return s.replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '');
}

// 音檔 → 長度（秒）
function readDurations(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const idCol = header.indexOf('音檔');
  const secCol = header.indexOf('長度(秒)');
  const map = new Map();
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    map.set(cols[idCol].toLowerCase(), parseFloat(cols[secCol]));
  }
  return map;
}

function toSeconds(t) {
  const [m, s] = t.split(':');
  return parseInt(m, 10) * 60 + parseFloat(s);
}

function formatDuration(sec) {
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (h ? `${h} 小時 ` : '') + `${m} 分 ${String(s).padStart(2, '0')} 秒`;
}

// 音檔順序：001a=0、001b=1、002a=2 ……
function chapterOrder(ch) {
  return (parseInt(ch, 10) - 1) * 2 + (ch.endsWith('b') ? 1 : 0);
}

function chapterName(order) {
  return `${String(Math.floor(order / 2) + 1).padStart(3, '0')}${order % 2 ? 'b' : 'a'}`;
}

// 全部參照文字接成一個長字串，記下每一筆的起點，才能找到跨兩筆的文字
let book = '';
const starts = [];
for (const r of index) {
  starts.push(book.length);
  book += r.text;
}

function idAt(pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return index[lo].id;
}

function findAll(q) {
  const out = [];
  for (let at = book.indexOf(q); at >= 0; at = book.indexOf(q, at + 1)) out.push({ at, id: idAt(at), endId: idAt(at + q.length - 1) });
  return out;
}

// 兩個時間點之間的秒數，時間點可以在不同卷
function secondsBetween(fromCh, fromTime, toCh, toTime, durations) {
  const from = chapterOrder(fromCh);
  const to = chapterOrder(toCh);
  const startSec = toSeconds(fromTime);
  const endSec = toSeconds(toTime);
  if (from === to) return endSec - startSec;
  let sum = durations.get(chapterName(from)) - startSec;
  for (let o = from + 1; o < to; o++) sum += durations.get(chapterName(o));
  return sum + endSec;
}

function totalSeconds(s, e, durations) {
  return secondsBetween(s['chapter-number'], s['section-time'], e['section-end-chapter-number'], e['section-end-time'], durations);
}

// 把 bold[startId..endId] 切成 parts 份：每一份的目標長度 = 剩下的時間 ÷ 剩下的份數，
// 在粗體字 section 的起點裡找最接近目標的點當切點
function split(startId, endId, parts, durations) {
  const count = endId - startId + 1;
  if (parts > count) throw new Error(`範圍裡只有 ${count} 段粗體字，最多切成 ${count} 份`);
  const first = bold[startId];
  const elapsed = (id) => secondsBetween(first['chapter-number'], first['section-time'], bold[id]['chapter-number'], bold[id]['section-time'], durations);
  const total = totalSeconds(first, bold[endId], durations);

  const result = [];
  let from = startId;
  for (let left = parts; left > 1; left--) {
    const target = elapsed(from) + (total - elapsed(from)) / left;
    // 切點是下一份的第一段：至少留一段給這一份，也要留夠段數給後面每一份
    let best = from + 1;
    for (let id = from + 1; id <= endId - (left - 2); id++) {
      if (Math.abs(elapsed(id) - target) < Math.abs(elapsed(best) - target)) best = id;
    }
    result.push([from, best - 1]);
    from = best;
  }
  result.push([from, endId]);
  return result;
}

// 音檔 ID 在播放連結裡的寫法：098a → 98a
function linkId(order) {
  return chapterName(order).replace(/^0+/, '');
}

// 播放連結，格式照連結產生器：同一個音檔 af1/st1/et1；兩個音檔 af1/st1/af2/et2；三個音檔 af1/st1/af2/af3/et3。
// 播放頁一個連結最多 3 個音檔，超過時依序拆成多個連結；et = -1 表示播到音檔結尾。
function makeLinks(fromCh, fromTime, toCh, toTime, durations) {
  const from = chapterOrder(fromCh);
  const to = chapterOrder(toCh);
  const endSec = toSeconds(toTime);
  const links = [];
  for (let first = from; first <= to; first += 3) {
    const last = Math.min(first + 2, to);
    let q = '?&tch=gl1';
    for (let o = first; o <= last; o++) {
      const n = o - first + 1;
      q += `&af${n}=${linkId(o)}`;
      if (o === first) q += `&st${n}=${o === from ? Math.round(toSeconds(fromTime)) : 0}`;
      if (o === last) {
        const atFileEnd = o !== to || Math.abs(endSec - durations.get(chapterName(o))) < 0.5;
        q += `&et${n}=${atFileEnd ? -1 : Math.round(endSec)}`;
      }
    }
    links.push(`https://lamrim.xyz/player2/${q}`);
  }
  return links;
}

function printRange(s, e, durations) {
  console.log(`第 ${s['chapter-number'].toUpperCase()} 卷 開始時間 ${s['section-time']} ${s['section-txt'].replace(/\n/g, ' ')} ~`);
  console.log(`第 ${e['section-end-chapter-number'].toUpperCase()} 卷 結束時間 ${e['section-end-time']} ${e['section-txt'].replace(/\n/g, ' ')}`);
  console.log(`總共 ${formatDuration(totalSeconds(s, e, durations))}`);
}

function printLink(label, s, e, durations) {
  const fromCh = s['chapter-number'];
  const toCh = e['section-end-chapter-number'];
  console.log(`(${label}) 《廣論》南普陀版 [${linkId(chapterOrder(fromCh)).toUpperCase()}] ${s['section-time']}~[${linkId(chapterOrder(toCh)).toUpperCase()}] ${e['section-end-time']}`);
  for (const url of makeLinks(fromCh, s['section-time'], toCh, e['section-end-time'], durations)) console.log(url);
}

function parseArgs(argv) {
  const texts = [];
  let parts = 1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-s') {
      parts = Number(argv[++i]);
      if (!Number.isInteger(parts) || parts < 1) throw new Error('-s 後面要接 1 以上的整數');
    } else texts.push(argv[i]);
  }
  if (texts.length !== 2) throw new Error('用法：node find-range.js [-s <份數>] <起始文字> <結尾文字>');
  return { startRaw: texts[0], endRaw: texts[1], parts };
}

function main() {
  const { startRaw, endRaw, parts } = parseArgs(process.argv.slice(2));
  const startQ = plainText(startRaw);
  const endQ = plainText(endRaw);
  if (!startQ || !endQ) throw new Error('起始文字與結尾文字都要有字');

  const startHits = findAll(startQ);
  if (!startHits.length) throw new Error(`找不到起始文字：${startRaw}`);
  const endHits = findAll(endQ);
  if (!endHits.length) throw new Error(`找不到結尾文字：${endRaw}`);

  const durations = readDurations(path.resolve('mp3-duration-gl1.csv'));
  const ranges = [];
  for (const sh of startHits) {
    const eh = endHits.find((h) => h.at >= sh.at);
    if (eh) ranges.push({ startId: sh.id, endId: eh.endId });
  }
  if (!ranges.length) throw new Error('結尾文字都在起始文字之前');
  if (ranges.length > 1) console.log(`起始文字出現 ${ranges.length} 次，列出每一個範圍：\n`);

  for (const { startId, endId } of ranges) {
    const pieces = parts === 1 ? [] : split(startId, endId, parts, durations);
    printRange(bold[startId], bold[endId], durations);
    printLink('全', bold[startId], bold[endId], durations);
    console.log('');
    pieces.forEach(([a, b], i) => {
      console.log(`【第 ${i + 1} 份】`);
      printRange(bold[a], bold[b], durations);
      printLink(i + 1, bold[a], bold[b], durations);
      console.log('');
    });
  }
}

try {
  main();
} catch (err) {
  console.error(`錯誤：${err.message}`);
  process.exitCode = 1;
}
