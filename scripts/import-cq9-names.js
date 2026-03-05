#!/usr/bin/env node
// ──────────────────────────────────────────────
// นำเข้าชื่อเกม CQ9 จากลิสต์ URL + ชื่อ หรือ game_id + ชื่อ
// วิธีใช้:
//   1. ใส่ลิสต์ใน data/cq9-names-input.txt (บรรทัดละ 1 เกม)
//   2. รัน: node scripts/import-cq9-names.js
//
// รูปแบบที่รับได้ (บรรทัดละอย่างใดอย่างหนึ่ง):
//   https://demo.cqgame.games/en/Game/Detail?game_id=220  Floating Market
//   https://demo.cqgame.games/en/Game/Detail?game_id=GO06  Paradise 2
//   220  Floating Market
//   game_id=GO06  Paradise 2
// ──────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const INPUT_FILE = path.join(DATA_DIR, 'cq9-names-input.txt');
const NAMES_FILE = path.join(DATA_DIR, 'cq9-names.json');

function parseLine(line) {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  let gameId = null;
  let name = '';
  const matchUrl = t.match(/game_id=([^&\s]+)/i);
  if (matchUrl) {
    gameId = matchUrl[1];
    const afterId = t.substring(t.toLowerCase().indexOf('game_id=' + gameId.toLowerCase()) + ('game_id='.length + gameId.length));
    name = afterId.replace(/^[\s&]+/, '').trim();
    if (!name) {
      const parts = t.split(/\s{2,}|\t/);
      if (parts.length >= 2) name = parts.slice(1).join(' ').trim();
    }
  } else {
    const parts = t.split(/\s{2,}|\t/);
    const first = parts[0].trim();
    if (/^\d+$/.test(first) || /^[A-Za-z0-9]+$/.test(first)) {
      gameId = first;
      name = parts.slice(1).join(' ').trim();
    }
  }
  if (gameId && name) return { game_id: gameId, name };
  return null;
}

function main() {
  let inputPath = process.argv[2] || INPUT_FILE;
  if (!fs.existsSync(inputPath)) {
    console.error('ไม่พบไฟล์:', inputPath);
    console.error('สร้างไฟล์และใส่ลิสต์ (บรรทัดละเกม) เช่น:');
    console.error('  220  Floating Market');
    console.error('  209  The Cupids');
    console.error('  https://demo.cqgame.games/en/Game/Detail?game_id=221  Sung Wukong');
    process.exit(1);
  }
  const content = fs.readFileSync(inputPath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const updates = {};
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed) {
      updates[parsed.game_id] = parsed.name;
    }
  }
  if (Object.keys(updates).length === 0) {
    console.error('ไม่พบรายการที่แปลงได้ จาก', inputPath);
    process.exit(1);
  }
  let existing = {};
  try {
    if (fs.existsSync(NAMES_FILE)) {
      const data = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf-8'));
      if (data && typeof data === 'object') {
        Object.keys(data).forEach(k => {
          if (k.startsWith('_')) return;
          if (typeof data[k] === 'string') existing[k] = data[k];
        });
        if (data._comment) existing._comment = data._comment;
      }
    }
  } catch (e) {}
  const merged = { ...existing };
  Object.keys(merged).filter(k => k.startsWith('_')).forEach(k => { merged[k] = existing[k]; });
  Object.assign(merged, updates);
  if (!merged._comment) merged._comment = 'ชื่อเกมจริงตาม game_id (แก้ได้ตรงนี้ หรือรัน node scripts/import-cq9-names.js)';
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(NAMES_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  console.log('อัปเดต', Object.keys(updates).length, 'ชื่อ ใน', NAMES_FILE);
  Object.entries(updates).slice(0, 10).forEach(([id, name]) => console.log('  ', id, '→', name));
  if (Object.keys(updates).length > 10) console.log('  ...');
}

main();
