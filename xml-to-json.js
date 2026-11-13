#!/usr/bin/env node
// 從 XML 文字稿取出粗體字（經文原文）與時間，輸出成一個 JSON 檔
//
// 用法：node xml-to-json.js [XML 資料夾] [MP3 長度 CSV] [輸出 JSON]
//   預設：xml\gl1、mp3-duration-gl1.csv、bold-gl1.json（都在執行時所在的資料夾底下）
//
// section-end-time 是下一個有粗體字的 section 的起始時間，可能在後面的 XML 檔，
// 所在的檔案記在 section-end-chapter-number。最後一個粗體字 section 用 CSV 裡最後一個音檔的長度。

const fs = require('fs');
const path = require('path');

const xmlDir = path.resolve(process.argv[2] || path.join('xml', 'gl1'));
const csvPath = path.resolve(process.argv[3] || 'mp3-duration-gl1.csv');
const outPath = path.resolve(process.argv[4] || 'bold-gl1.json');

function unescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// 讀 CSV：音檔 → 長度(分:秒)
function readDurations(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const idCol = header.indexOf('音檔');
  const lenCol = header.indexOf('長度(分:秒)');
  if (idCol < 0 || lenCol < 0) throw new Error(`${file} 找不到「音檔」或「長度(分:秒)」欄`);
  const map = new Map();
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    map.set(cols[idCol].toLowerCase(), cols[lenCol]);
  }
  return map;
}

function readBoldSections(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const teaching = /<teaching>(.*?)<\/teaching>/.exec(xml)[1];
  const chapter = /<chapter-number>(.*?)<\/chapter-number>/.exec(xml)[1];
  const result = [];
  for (const m of xml.matchAll(/<section-time>(.*?)<\/section-time>\s*<section-txt>([\s\S]*?)<\/section-txt>/g)) {
    // 相鄰的粗體 span 是同一段原文，先接起來
    const txt = unescape(m[2]).replace(/<\/span>\s*<span class="bold-txt">/g, '');
    const bolds = [...txt.matchAll(/<span class="bold-txt">([\s\S]*?)<\/span>/g)].map((b) => b[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    if (!bolds.length) continue;
    result.push({ teaching, 'chapter-number': chapter, 'section-time': m[1], 'section-txt': bolds.join('\n') });
  }
  return { chapter, sections: result };
}

function main() {
  const durations = readDurations(csvPath);
  const files = fs.readdirSync(xmlDir).filter((f) => f.endsWith('.xml')).sort();
  if (!files.length) throw new Error(`${xmlDir} 裡沒有 XML 檔`);

  const all = [];
  let lastChapter;
  for (const f of files) {
    const { chapter, sections } = readBoldSections(path.join(xmlDir, f));
    all.push(...sections);
    lastChapter = chapter;
  }

  all.forEach((s, i) => {
    const next = all[i + 1];
    if (next) {
      s['section-end-chapter-number'] = next['chapter-number'];
      s['section-end-time'] = next['section-time'];
    } else {
      const len = durations.get(lastChapter.toLowerCase());
      if (!len) throw new Error(`${csvPath} 找不到 ${lastChapter} 的長度`);
      s['section-end-chapter-number'] = lastChapter;
      s['section-end-time'] = len;
    }
  });

  fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + '\n');
  console.log(`讀取 ${files.length} 個 XML 檔，輸出 ${all.length} 筆粗體字 section → ${outPath}`);
}

try {
  main();
} catch (err) {
  console.error(`錯誤：${err.message}`);
  process.exitCode = 1;
}
