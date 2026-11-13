#!/usr/bin/env node
// 從 bold-gl1.json 產生搜尋用的參照檔：section-txt 移除標點符號與空白，只留文字
//
// 用法：node make-index.js [粗體字 JSON] [輸出參照檔]
//   預設：bold-gl1.json、bold-gl1-index.json（都在執行時所在的資料夾底下）
//
// id 是該筆在 bold-gl1.json 陣列裡的位置（從 0 開始），用 id 就能取回起始與結束時間：
//   bold[id]['chapter-number'], bold[id]['section-time'], bold[id]['section-end-chapter-number'], bold[id]['section-end-time']

const fs = require('fs');
const path = require('path');

const boldPath = path.resolve(process.argv[2] || 'bold-gl1.json');
const outPath = path.resolve(process.argv[3] || 'bold-gl1-index.json');

// 只保留漢字、字母、數字
function plainText(s) {
  return s.replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '');
}

try {
  const bold = JSON.parse(fs.readFileSync(boldPath, 'utf8'));
  const index = bold.map((s, id) => ({ id, text: plainText(s['section-txt']) }));
  fs.writeFileSync(outPath, JSON.stringify(index, null, 2) + '\n');
  console.log(`讀取 ${bold.length} 筆，輸出參照檔 → ${outPath}`);
} catch (err) {
  console.error(`錯誤：${err.message}`);
  process.exitCode = 1;
}
