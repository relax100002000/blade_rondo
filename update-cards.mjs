#!/usr/bin/env node
// update-cards.mjs
// 從 https://sdrice.name 下載 Blade Rondo 原始卡牌資料並轉成本專案使用的 cards.js
// 用法：node update-cards.mjs
//
// 注意：取得的卡牌文字 © 旭翼文化 / Domina Game，請勿用於商業用途。
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = 'https://sdrice.name/dist/js/blade_rondo_data.min.js';
const OUTPUT = path.join(__dirname, 'cards.js');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let data = ''; res.setEncoding('utf8');
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  console.log('→ 抓取', SOURCE);
  const src = await fetchText(SOURCE);

  // 原始檔的內容是 `window.cardData=[...]`。改成在 sandbox 裡 eval。
  const sandbox = { window: {} };
  new Function('window', src)(sandbox.window);
  const cardData = sandbox.window.cardData;
  if (!Array.isArray(cardData)) throw new Error('來源資料格式異常');

  console.log(`→ 解析 ${cardData.length} 個牌組`);
  for (const pack of cardData) {
    const n = (pack.list || []).length;
    console.log(`   · ${pack.name}  (${pack.namecn || ''})  : ${n} 張`);
  }

  // 輸出 cards.js（用 JSON.stringify 保留所有原文欄位）
  const header = [
    '// cards.js — 由 update-cards.mjs 自動生成',
    `// 來源：${SOURCE}`,
    '// 內容版權 © 旭翼文化 / Domina Game，僅供個人同好試玩。',
    '',
    'window.RAW_CARD_DATA = ' + JSON.stringify(cardData, null, 2) + ';',
    '',
    'window.ALL_CARDS = (() => {',
    '  const arr = [];',
    '  for (const pack of window.RAW_CARD_DATA) {',
    '    if (pack.id === "common") continue;',
    '    for (const c of (pack.list || [])) arr.push({ ...c, pack: pack.id, packName: pack.namecn || pack.name });',
    '  }',
    '  return arr;',
    '})();',
    '',
    'window.CARD_BY_ID = (() => {',
    '  const m = {};',
    '  for (const pack of window.RAW_CARD_DATA) for (const c of (pack.list || [])) m[c.id] = { ...c, pack: pack.id, packName: pack.namecn || pack.name };',
    '  return m;',
    '})();',
    '',
    'window.COMMON_CARDS = (window.RAW_CARD_DATA.find(p => p.id === "common")?.list || []).map(c => ({ ...c, pack: "common", packName: "COMMON" }));',
    ''
  ].join('\n');

  fs.writeFileSync(OUTPUT, header);
  console.log(`✓ 已寫入 ${OUTPUT}`);
  console.log(`✓ 檔案大小 ${fs.statSync(OUTPUT).size} bytes`);
  console.log('');
  console.log('下次想更新只要再跑一次 node update-cards.mjs 即可。');
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
