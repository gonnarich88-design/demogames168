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
