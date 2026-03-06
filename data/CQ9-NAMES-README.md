# ชื่อเกม CQ9 ให้ตรงกับเกมจริง

## วิธีส่งลิสต์ URL + ชื่อเกม

### วิธีที่ 1: ใส่ในไฟล์แล้วรันสคริปต์

1. แก้ไฟล์ **`data/cq9-names-input.txt`**
2. ใส่บรรทัดละ 1 เกม (รูปแบบใดอย่างหนึ่ง):

   ```
   220  Floating Market
   209  The Cupids
   https://demo.cqgame.games/en/Game/Detail?game_id=221  Sung Wukong
   ```

3. รันคำสั่ง:

   ```bash
   node scripts/import-cq9-names.js
   ```

4. ระบบจะอัปเดต `data/cq9-names.json` ให้ จากนั้น restart server (หรือ deploy) แล้วรีเฟรชแอป

### วิธีที่ 2: ส่งผ่าน API

ส่ง **POST** ไปที่ `/api/cq9-names` โดยมี body เป็น JSON แบบใดแบบหนึ่ง:

**แบบ object (game_id เป็น key):**
```json
{
  "names": {
    "200": "Buffalo",
    "209": "The Cupids",
    "220": "Floating Market"
  }
}
```

**แบบ array:**
```json
{
  "list": [
    { "game_id": 200, "name": "Buffalo" },
    { "game_id": 209, "name": "The Cupids" }
  ]
}
```

**แบบข้อความ (บรรทัดละเกม):**
```json
{
  "lines": "220  Floating Market\n209  The Cupids\n221  Sung Wukong"
}
```

ตัวอย่างใช้ curl:
```bash
curl -X POST https://your-domain.com/api/cq9-names \
  -H "Content-Type: application/json" \
  -d '{"names":{"209":"The Cupids","220":"Floating Market"}}'
```

หลังอัปเดตแล้ว ชื่อในแคตตาล็อก CQ9 จะใช้จาก `cq9-names.json` ทันที (เกมที่ยังไม่มีในลิสต์จะแสดงเป็น "เกม #200" ฯลฯ)

---

## ดึงรายชื่อเกมจากเว็บ CQ9 (ทางเลือก B)

ถ้าอยากให้ลิสต์เกม + ชื่อ มาจากเว็บ CQ9 จริง ๆ:

- **API (ตอน deploy แล้ว):** ส่ง `POST /api/cq9-refresh-games` → server จะไปดึงหน้า demo.cqgame.games แล้วเขียน `data/cq9-games.json`  
  ปัจจุบันเว็บ CQ9 โหลดรายชื่อด้วย JavaScript ฝั่ง client บางครั้ง API นี้ได้ 0 เกม (แล้วใช้ seed ต่อ)

- **สคริปต์ Puppeteer (เครื่องตัวเอง):** รัน `node scripts/fetch-cq9-games-puppeteer.js`  
  ต้องติดตั้ง Chrome ก่อน: `npx puppeteer browsers install chrome` (ใช้พื้นที่ ~150MB+)

- **ไม่ดึงจากเว็บ:** ใช้ seed + ชื่อที่แมปเอง แล้วสร้างไฟล์ลิสต์เกม:
  1. ใส่ URL/ชื่อใน `data/cq9-names-input.txt`
  2. รัน `node scripts/import-cq9-names.js` (อัปเดต `cq9-names.json`)
  3. รัน `node scripts/build-cq9-games-from-names.js` (สร้าง `data/cq9-games.json` จาก seed + ชื่อ)

  หลังรัน 2 สคริปต์แล้ว restart server แคตตาล็อกจะโชว์ชื่อจาก `cq9-names.json` ครบ (และเกมที่มีแค่ใน names เช่น GO03 จะถูกเพิ่มเข้าไปในลิสต์ด้วย)
