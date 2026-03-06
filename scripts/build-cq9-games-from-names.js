#!/usr/bin/env node
// ──────────────────────────────────────────────
// สร้าง data/cq9-games.json จาก seed + cq9-names.json
// ใช้เมื่อดึงรายชื่อจากเว็บ CQ9 ไม่ได้ (หน้าโหลดด้วย JS) แต่มีชื่อใน cq9-names
// รัน: node scripts/build-cq9-games-from-names.js
// ก่อนรันควรอัปเดตชื่อก่อน: node scripts/import-cq9-names.js
// ──────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEED_FILE = path.join(DATA_DIR, 'cq9-seed-games.json');
const NAMES_FILE = path.join(DATA_DIR, 'cq9-names.json');
const OUT_FILE = path.join(DATA_DIR, 'cq9-games.json');

function main() {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
    if (!Array.isArray(list)) list = [];
  } catch (e) {
    console.error('ไม่พบหรืออ่าน seed ไม่ได้:', SEED_FILE);
    process.exit(1);
  }

  let names = {};
  try {
    if (fs.existsSync(NAMES_FILE)) {
      const data = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf-8'));
      if (data && typeof data === 'object') {
        Object.keys(data).forEach(k => {
          if (k.startsWith('_')) return;
          if (typeof data[k] === 'string') names[k] = data[k].trim();
        });
      }
    }
  } catch (e) {}

  const byId = new Map();
  list.forEach(g => {
    const id = String(g.game_id);
    const name = names[id] || g.name || (id.match(/^\d+$/) ? `เกม #${id}` : `เกม #${id}`);
    byId.set(id, { ...g, game_id: g.game_id, name, category: g.category || 'Slot', image: g.image || '' });
  });

  Object.entries(names).forEach(([id, name]) => {
    if (byId.has(id)) return;
    byId.set(id, {
      game_id: id.match(/^\d+$/) ? parseInt(id, 10) : id,
      name: name.trim(),
      category: 'Slot',
      image: ''
    });
  });

  const out = Array.from(byId.values());
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf-8');
  console.log('เขียน', out.length, 'เกมลง', OUT_FILE);
  const withCustomName = out.filter(g => names[String(g.game_id)]);
  if (withCustomName.length) {
    console.log('ชื่อจาก cq9-names:', withCustomName.length, 'เกม');
    withCustomName.slice(0, 8).forEach(g => console.log('  ', g.game_id, '→', g.name));
    if (withCustomName.length > 8) console.log('  ...');
  }
}

main();
