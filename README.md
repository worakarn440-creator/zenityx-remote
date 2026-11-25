# ZenityX Remote — แอปรีโมทหน้าจอฟรี สำหรับครูช่วยนักเรียน

Signaling server: https://zenityx-remote.agen-web-deploy.workers.dev (Cloudflare Workers)

## วิธีใช้ (สำหรับนักเรียน/ครู)
1. ดับเบิลคลิก `ZenityX-Remote.exe` (ไม่ต้องติดตั้ง)
   - ถ้า Windows ขึ้นหน้าต่างสีฟ้า "Windows protected your PC" ให้กด **More info → Run anyway** (เพราะแอปยังไม่ได้ซื้อใบรับรองเซ็นชื่อ)
2. นักเรียนบอก **รหัส 9 หลัก** ที่เห็นบนหน้าจอให้ครู
3. ครูเปิดแอป ใส่รหัสในช่อง "เชื่อมต่อไปยังเครื่องอื่น" แล้วกด **เชื่อมต่อ**
4. นักเรียนกด **อนุญาต ดูและควบคุมได้** (หรือ "ดูอย่างเดียว") — หยุดได้ทุกเมื่อด้วยปุ่ม **หยุดแชร์**

หมายเหตุ: ผู้ดูพิมพ์ตามตำแหน่งปุ่มจริง ดังนั้นภาษาไทย/อังกฤษขึ้นกับเลย์เอาต์ของเครื่องนักเรียน
Ctrl+Alt+Del และหน้าต่างที่เปิดด้วยสิทธิ์ผู้ดูแล (UAC) ควบคุมไม่ได้

## macOS
- ใช้ได้ทั้ง Mac ชิป Apple (arm64) และ Intel (x64) ไฟล์ `.dmg` ถูก build ด้วย GitHub Actions (`.github/workflows/build.yml`) เพราะ build Mac บน Windows ไม่ได้
- เครื่อง Mac ที่ถูกดูต้องเปิดสิทธิ์ **Screen Recording** และ **Accessibility** ให้แอป (แอปจะแจ้งเตือนในหน้าหลัก)
- แอปไม่ได้เซ็นชื่อกับ Apple จึงต้องกด **Open Anyway** ที่ Privacy & Security ครั้งแรก
- ข้ามแพลตฟอร์ม: แอปแปลง Ctrl ↔ Command ให้อัตโนมัติ
- ⚠️ โค้ดฝั่ง Mac ยังไม่ผ่านการทดสอบบนเครื่อง Mac จริง

## โครงสร้างโปรเจกต์
| โฟลเดอร์/ไฟล์ | หน้าที่ |
|---|---|
| `main.js`, `preload.js` | โปรเซสหลัก Electron: รหัสเครื่อง, เลือกจอ, ฉีดเมาส์/คีย์บอร์ด |
| `src/input.js`, `src/keymap.js` | ควบคุมเมาส์/คีย์บอร์ดด้วย nut-js |
| `renderer/` | หน้าจอแอป + WebRTC + signaling client (ต่อใหม่อัตโนมัติ) |
| `worker/` | signaling server บน Cloudflare Workers (ฟรี) |
| `server/server.js` | signaling server แบบ Node สำหรับทดสอบ/ใช้ใน LAN |
| `config.default.json` | ที่อยู่ signaling server ที่ฝังในแอป (`signalUrl`) |

## สำหรับผู้พัฒนา
```powershell
npm install
npm run server      # เปิด signaling ทดสอบที่ ws://localhost:8787
npm start           # รันแอป
npm run dist        # build เป็น dist\ZenityX-Remote.exe
```
- เปลี่ยน server โดยแก้ `signalUrl` ใน `config.default.json` (หรือไฟล์ `config.json` ใน userData, หรือ env `CLASSREMOTE_SIGNAL`) แล้ว build ใหม่
- Deploy worker: `cd worker` แล้ว `npx wrangler deploy`
- TURN relay (เมื่อเน็ตต่อตรงไม่ได้): ตั้ง secret `TURN_KEY_ID` และ `TURN_API_TOKEN` ของ Cloudflare Realtime ให้ worker ระบบจะแจก ICE server ให้แอปเองที่ `/ice`

## ความปลอดภัย
- ปลายทางต้องกดอนุญาตทุกครั้ง เลือก "ดูอย่างเดียว" ได้
- ภาพและการควบคุมวิ่งตรงระหว่างเครื่องด้วย WebRTC (เข้ารหัส DTLS-SRTP) server กลางเห็นแค่ข้อความจับคู่
- รหัสเครื่องสุ่ม 9 หลัก ไม่เปลี่ยนเมื่อเปิดแอปใหม่
