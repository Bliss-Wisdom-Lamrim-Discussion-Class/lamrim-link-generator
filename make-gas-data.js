#!/usr/bin/env node
// 把 bold-gl1.json 與 mp3-duration-gl1.csv 轉成 Apps Script 用的 gas\data.gs
//
// 用法：node make-gas-data.js
//   讀執行時所在資料夾底下的 bold-gl1.json、mp3-duration-gl1.csv，輸出 gas\data.gs
//
// data.gs 內容：
//   DATA.durations：音檔 → 長度（秒），例如 "098a": 1789.1905
//   DATA.sections：每段粗體字一筆 [chapter-number, section-time, section-end-chapter-number, section-end-time, section-txt]
//                  順序跟 bold-gl1.json 相同，陣列位置就是 bold-gl1-index.json 的 id

const fs = require('fs');
const path = require('path');

const bold = JSON.parse(fs.readFileSync(path.resolve('bold-gl1.json'), 'utf8'));
const lines = fs.readFileSync(path.resolve('mp3-duration-gl1.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
const header = lines[0].split(',');
const idCol = header.indexOf('音檔');
const secCol = header.indexOf('長度(秒)');

const durations = {};
for (const line of lines.slice(1)) {
  const cols = line.split(',');
  durations[cols[idCol].toLowerCase()] = parseFloat(cols[secCol]);
}

const sections = bold.map((s) => [s['chapter-number'], s['section-time'], s['section-end-chapter-number'], s['section-end-time'], s['section-txt']]);

const outDir = path.resolve('gas');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'data.gs');
fs.writeFileSync(out, `// 由 make-gas-data.js 產生，不要手動修改\nvar DATA = ${JSON.stringify({ durations, sections })};\n`);
console.log(`音檔 ${Object.keys(durations).length} 個、粗體字 ${sections.length} 段 → ${out}（${fs.statSync(out).size} bytes）`);
