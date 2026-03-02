# บอท Telegram — ให้ขึ้นแบบเดิม (รูปต้อนรับ + ปุ่ม)

## พฤติกรรมที่ถูกต้อง (โค้ดใน repo นี้)

- **/start** → ส่งรูปต้อนรับ + ข้อความยินดีต้อนรับ + ปุ่ม 4 ปุ่ม (ทดลองเล่นฟรี, หน้าเว็บหลัก, กลุ่มหลัก, สมัครสมาชิก)
- **/games** → ข้อความ "🎰 เลือกค่ายเกม" + ปุ่มเลือกค่าย (JILI, PP, Joker ฯลฯ) กดแล้วเปิด Web App

## ถ้าบอทขึ้นแบบผิด (แค่ "สวัสดีครับ ผม co168bot" / "รายการเกม: เกม 1, 2, 3")

แปลว่าเซิร์ฟเวอร์ที่รับคำสั่งบอท **ไม่ได้รันโค้ดจาก repo นี้**

### วิธีแก้ให้กลับขึ้นแบบเดิม

1. **ใช้โค้ดจาก repo นี้บนเซิร์ฟเวอร์ที่รันบอท**
   - โคลนหรือ pull โค้ด miniapp นี้
   - ใช้ `server.js` เป็นตัวรัน (มีทั้งเว็บและบอท)

2. **ตั้งค่า .env บนเซิร์ฟเวอร์**
   - `BOT_TOKEN` = โทเคนของ @co168bot (จาก BotFather)
   - `WEBAPP_URL` = URL ของ Web App (เช่น https://demogames.sky168.info)

3. **รันบอทด้วย server.js นี้เท่านั้น**
   ```bash
   node server.js
   ```
   หรือ `npm start`  
   **ห้ามรันสคริปต์บอทอื่นที่ใช้ BOT_TOKEN เดียวกัน** (เช่น bot แยกไฟล์ที่ตอบ "สวัสดีครับ" / "รายการเกม: เกม 1, 2, 3") เพราะจะทำให้คำสั่งไปที่โค้ดเก่า

4. **รีสตาร์ทหลัง deploy**
   - แก้โค้ดหรือ .env แล้วต้อง restart process (pm2 restart / systemctl restart / ฯลฯ)

5. **ตรวจว่าไม่มี process ซ้ำ**
   - ตรวจว่าไม่มี node script อื่นที่ใช้ `BOT_TOKEN` เดียวกันรันอยู่ (โฟลว์อัปเดตจะไปที่ process ที่ลงทะเบียนกับ Telegram ก่อน)

## ตรวจว่าเซิร์ฟเวอร์รันโค้ดชุดนี้ + เช็คการเชื่อมต่อบอท

เปิด **https://โดเมนของคุณ/api/bot-check** จะได้ JSON แบบนี้:

- **active** — บอทโหลดใน server นี้หรือไม่
- **telegram.connected** — เชื่อมต่อ Telegram API ได้หรือไม่ (ถ้า false มักเป็น BOT_TOKEN ผิด หรือเครือข่าย/ไฟร์วอลล์)
- **lastUpdateAt** / **lastUpdateAgo** — เวลาที่เซิร์ฟเวอร์นี้รับอัปเดตล่าสุดจาก Telegram  
  - ถ้า **lastUpdateAgo เก่ามาก (หรือ null)** แปลว่าอัปเดต (เช่น /start) **ไม่มาที่เซิร์ฟเวอร์นี้** → น่าจะมี process อื่นใช้ BOT_TOKEN เดียวกันรันอยู่ (โฟลว์ไปที่ตัวนั้น)
  - ถ้า **lastUpdateAgo ใหม่** แต่ user กด /start แล้วไม่มีอะไรขึ้น → ดู log เซิร์ฟเวอร์ว่ามี `[BOT] /start received` และมี `[BOT] Error in /start` หรือไม่

ดู log ตอนสตาร์ท ควรเห็น `🤖 Telegram bot started — @co168bot`

---

## การเก็บสถิติบอท — เวลา deploy ห้ามมายุ่งกับไฟล์/volume นี้

สถิติการใช้งานบอท (ใครกด /start, /games ฯลฯ) เก็บในไฟล์ JSON ที่ path ต่อไปนี้:

| สิ่งที่ใช้ | Path (production) | หมายเหตุ |
|-----------|--------------------|----------|
| ไฟล์หลัก | `/app/data/stats/bot-events.json` | อ่าน/เขียนจากแอป |
| Volume (Docker) | `app-data` → `/app/data/stats` | ต้องเป็น volume เพื่อให้ข้อมูลไม่หายตอน deploy (ไม่ mount ทับ `/app/data` ทั้งหมด เพราะ `data/providers.json` ต้องอยู่ในการ์ดค่ายเกม) |

### EasyPanel — ตั้งค่า Mount ให้ข้อมูลไม่หาย

ถ้า deploy บน **EasyPanel** ต้องเพิ่ม Volume/Mount เอง (ถ้าไม่ได้ใช้ docker-compose จาก repo):

1. เปิดแอปของ miniapp ใน EasyPanel → ไปที่แท็บ **Storage** / **Volumes** / **Mounts** (ชื่อเมนูอาจต่างกันตามเวอร์ชัน)
2. กด **Add Volume** หรือ **Add Mount**
3. ตั้งค่า:
   - **Container Path** (path ใน container): ใส่ **`/app/data/stats`**
   - **Volume**: สร้าง volume ใหม่ (เช่นชื่อ `miniapp-stats`) หรือเลือก volume ที่มีอยู่ — **ห้าม** mount ทับ `/app/data` ทั้งหมด ต้องเป็นแค่ `/app/data/stats`
4. Save แล้ว Redeploy/Restart แอป

หลังตั้งค่าแล้ว ไฟล์สถิติจะอยู่บน volume นี้ deploy ใหม่หรือ rebuild ครั้งต่อไป ข้อมูลจะไม่หาย (ตราบใดที่ไม่ได้ลบ volume ใน EasyPanel)

### กฎเวลา Deploy (ห้ามทำ)

- **Docker:** ห้ามลบ volume `app-data` หรือสั่ง `docker compose down -v` (ตัว -v จะลบ volume)
- **Docker:** ห้าม mount volume ทับ `/app/data` ทั้งหมด (ให้ mount เฉพาะ `/app/data/stats` — ดู docker-compose.yml)
- **Docker:** ห้าม copy ไฟล์จาก build/repo ไปทับ path เก็บสถิติ (โฟลเดอร์ใน image ถูก exclude ใน .dockerignore แล้ว)
- **ไม่ใช้ Docker:** ห้ามให้ path เก็บสถิติอยู่ภายในโฟลเดอร์ที่ deploy ทับทุกครั้ง (เช่น โฟลเดอร์ที่ git pull หรือ rsync เข้าไป) — ต้องใช้ path นอกโฟลเดอร์แอป เช่น `/var/lib/miniapp/bot-events.json`

### ทำอย่างไรให้ข้อมูลไม่หาย

1. **Deploy ด้วย docker-compose.yml ใน repo นี้**  
   มี volume `app-data` mount ที่ `/app/data/stats` อยู่แล้ว → ข้อมูลสถิติอยู่บน volume นี้ และจะไม่หายเมื่อสั่ง `docker compose build --pull && docker compose up -d` (ไม่ใช้ -v)

2. **Deploy แบบไม่ใช้ Docker**  
   ต้องให้ path เก็บสถิติอยู่นอกโฟลเดอร์ที่ deploy ทับทุกครั้ง และไม่ลบ/ไม่ overwrite โฟลเดอร์นั้นตอน deploy  
   - ตั้ง `BOT_EVENTS_PATH` ใน .env ชี้ไปที่ path นอกโฟลเดอร์แอป เช่น `/var/lib/miniapp/bot-events.json`  
   - สร้างโฟลเดอร์และตั้งสิทธิ์ก่อนรันแอป (เช่น `sudo mkdir -p /var/lib/miniapp && sudo chown $USER /var/lib/miniapp`)  
   - ห้ามลบหรือ deploy ทับโฟลเดอร์นั้น (เช่น ห้าม `rm -rf /var/lib/miniapp` หรือ copy โปรเจกต์ทับ path นี้)

3. **สำรองเพิ่ม (ถ้าต้องการ)**  
   ตั้ง `BOT_EVENTS_BACKUP_PATH` ใน .env เป็น path อีกที่หนึ่ง (เช่น volume อื่น หรือ host path) แอปจะเขียน backup ทุกครั้งที่เขียนไฟล์หลัก และจะกู้จาก backup ตอนสตาร์ทถ้าไฟล์หลักหายหรือว่าง
