# JSON Workbench for VS Code

เครื่องมือจัดการ JSON ใน VS Code ที่สร้างขึ้นโดยอ้างอิงการทำงานของ [json.site](https://json.site/) ประมวลผลในเครื่องและใช้งานออฟไลน์ได้ ตัว extension เป็นโปรเจกต์อิสระ ไม่ใช่ extension อย่างเป็นทางการของ json.site

## ติดตั้งและเปิดใช้งาน

1. ใน VS Code กด `Ctrl+Shift+P` แล้วเลือก **Extensions: Install from VSIX...**
2. เลือกไฟล์ `json-workbench-local-0.2.0.vsix` ในโฟลเดอร์นี้
3. กด `Ctrl+Shift+P` แล้วเลือก **JSON Workbench: Open** หรือกด **Alt+J** เพื่อเปิดหน้าต่าง

หรือใช้ Terminal:

```powershell
code --install-extension .\json-workbench-local-0.2.0.vsix
```

คลิกขวาใน editor แล้วเลือก **JSON Workbench: Open Selection or Document** เพื่อเปิดข้อความที่เลือก หรือทั้งไฟล์ หากไม่ได้เลือกข้อความไว้ รองรับคลิกขวาไฟล์ `.json` ใน Explorer ด้วย ต้องใช้ VS Code 1.96 ขึ้นไป

## ฟีเจอร์

| การทำงาน | วิธีใช้ |
| --- | --- |
| Editor สองคอลัมน์ | วาง JSON ด้านซ้าย ผลที่จัดรูปแบบแสดงด้านขวาโดยอัตโนมัติ แก้ไขได้ทั้งสองฝั่ง |
| Validation | แสดงสถานะพร้อมตำแหน่งบรรทัด/คอลัมน์และขีดเส้นใต้ข้อผิดพลาด |
| Format / Minify | จัดรูปแบบหรือลบช่องว่าง เลือก 1–4 spaces หรือ Tab |
| Stringify / Unescape | แปลง JSON เป็น string หรือถอด string กลับเป็นข้อความ |
| Deep parse | แปลง JSON ที่ซ้อนอยู่ใน string ตาม object/array |
| Repair / Sort | ซ่อม JSON เช่น single quotes/trailing comma หรือเรียง key แบบ recursive |
| Tree | ขยายโครงสร้างทีละระดับ คัดลอกค่าและ JSON Pointer ของแต่ละ node |
| Table | แสดง object/array เป็นตาราง ครั้งละ 100 แถว พร้อมเปลี่ยนหน้า |
| Graph | แสดงโครงสร้างเป็นกล่องและเส้นเชื่อม ขยาย node ได้ |
| Type | สร้าง TypeScript, JavaScript, Python, Go, Java, C#, Rust, Swift, Kotlin, Dart, C++, Ruby และ JSON Schema |
| JSON Pointer | กรอก `/users/0/name` แล้วกด Go หรือ Extract; key ที่มี `/` ใช้ `~1` และ `~` ใช้ `~0` |
| Find / Fold / Expand | ค้นหา/แทนที่ใน Monaco และยุบ/ขยายโค้ด |
| Diff | เปรียบเทียบข้อความระหว่าง editor สองฝั่ง ปิด Auto format เพื่อแก้ไขแยกกัน |
| History | บันทึก snapshot ในเครื่อง ค้นหาจากชื่อ เปิดกลับมา และลบแต่ละรายการได้ |
| History sync | เลือกเปิด "Sync history across devices" เพื่อแชร์ประวัติผ่าน VS Code Settings Sync (ปิดโดยปริยาย ต้องเปิดในแต่ละเครื่อง) |
| Draft | คืนข้อความทั้งสองฝั่งและการตั้งค่าเมื่อเปิดกลับมา |
| เปิด/บันทึกไฟล์ | ใช้ Open/Save หรือวางไฟล์ลงใน pane |
| Share link | คัดลอกลิงก์ `vscode://<publisher>.json-workbench-local/open?...` ให้คนที่ติดตั้ง extension เดียวกัน |
| Appearance | Light/Dark/ตาม VS Code, ขนาดฟอนต์, Word wrap, ย่อเหลือ pane เดียว และลากปรับสัดส่วน |

คีย์ลัดใน editor: `Ctrl/Cmd+Enter` จัดรูปแบบ, `Ctrl/Cmd+S` บันทึกไฟล์, `Ctrl/Cmd+F` ค้นหา, `Ctrl/Cmd+Z` ย้อนกลับ

## ข้อมูลและขอบเขต

- ไม่มีการส่ง JSON ไปยังเว็บไซต์หรือบริการภายนอก ไม่มี telemetry ใน extension และไฟล์ JavaScript/CSS/worker รวมอยู่ใน VSIX
- การ Format/Minify รักษาตัวเลขตามข้อความเดิม รวมถึงเลขจำนวนเต็มเกิน `Number.MAX_SAFE_INTEGER` และทศนิยมยาว
- รับ input ได้ไม่เกิน **100 MiB**; การ parse ทำใน Web Worker ส่วน Tree/Table โหลดเป็นช่วงเพื่อลดจำนวน DOM nodes ความเร็วของไฟล์ใหญ่ขึ้นกับโครงสร้างและเครื่อง
- Type generation ใช้ sample ไม่เกิน **2 MiB** และมี timeout 30 วินาที ชนิดข้อมูลเป็นผลอนุมานจาก sample ต้องตรวจสอบก่อนใช้เป็น API contract
- Share link รองรับข้อมูลก่อนบีบอัดไม่เกิน **1 MiB** และข้อมูลที่บีบอัดแล้วไม่เกิน 12,000 ตัวอักษร ข้อมูลอยู่ในลิงก์โดยตรง ลิงก์ไม่ได้เข้ารหัสและผู้รับต้องติดตั้ง extension นี้ สำหรับข้อมูลใหญ่ใช้ Save แล้วส่งไฟล์
- History เก็บสูงสุด **50 รายการ / 200 MiB** ใน extension global storage ของ VS Code และ draft แยกอีกหนึ่งไฟล์ บันทึกหลังหยุดแก้ประมาณ 1 วินาที ปิดทันทีหรือโปรแกรม crash ก่อนบันทึกอาจเสียการแก้ไขล่าสุด
- History sync **ปิดโดยปริยาย** เมื่อเปิดในแถบ History จะแชร์ประวัติล่าสุดผ่าน **VS Code Settings Sync** ด้วยบัญชี VS Code ที่ล็อกอินอยู่ ข้อมูล JSON จึงออกจากเครื่อง ต้องเปิดในทุกเครื่องที่ใช้บัญชีเดียวกันและติดตั้ง extension นี้ แชร์ได้สูงสุด **20 รายการ / รายการละ 1 MiB / snapshot ละ 64 KiB** รายการที่ใหญ่หรือเก่ากว่านั้นและ draft จะไม่ถูกซิงก์และแสดงเป็น "local only" การลบจะถูกจดจำ 90 วันเพื่อไม่ให้รายการที่ลบกลับมา ปิด sync แล้วจะหยุดแชร์การเปลี่ยนแปลงใหม่ แต่ข้อมูลที่ซิงก์ไปแล้วยังอยู่ในบัญชี VS Code จนกว่าจะลบที่นั่น
- Remote SSH/WSL: ข้อมูลเก็บในเครื่องที่รัน extension host ตามกลไกของ VS Code
- ช่อง Search ใน Tree/Table/Graph ค้นหาเฉพาะแถวที่โหลดอยู่ ใช้ Find ใน Editor เพื่อค้นหาทั้งเอกสาร
- UI และบริการแชร์ไม่ได้เหมือนเว็บทุกจุด: ไม่มีลิงก์ฝากข้อมูลบน json.site, บัญชีผู้ใช้, community/feedback ของเว็บ หรือ UI หลายภาษา ไม่มีการอ้างว่าเป็นสำเนาแบบ pixel-perfect

## พัฒนา

This is a standalone extension project. Requires Node.js 22 or newer.

```powershell
npm ci
npm run check
npm test
npm run build
npm run test:ui
npm run test:vscode
npm run package
```

เปิดโฟลเดอร์นี้เป็น VS Code workspace แล้วกด F5 เพื่อเปิด Extension Development Host

- `src/extension.ts`: VS Code commands, file/clipboard bridge, storage และ URI handler
- `src/core.ts`: อ่าน/เขียน JSON, transformations, paths และข้อมูล Tree/Table
- `src/webview/`: Monaco, UI และ JSON workers
- `src/types-worker.ts`: แยก type generation ออกจาก extension host
- `test/`: ทดสอบ logic, UI และ VS Code activation
- `test-results/`: ผลทดสอบและภาพหน้าจอที่สร้างในเครื่อง ไม่รวมใน VSIX

UI test ใช้ Chrome บน Windows โดยปริยาย เปลี่ยน browser path ผ่าน `JSON_WORKBENCH_CHROME` ได้ ส่วน VS Code integration test ใช้ profile แยกใน `test-results/` และเปลี่ยน executable ผ่าน `JSON_WORKBENCH_VSCODE` ได้

## ข้อมูลอ้างอิง

ตรวจรายการฟีเจอร์และ controls บน [json.site](https://json.site/) เมื่อ 10 กันยายน 2026: นอกจาก Editor/Tree/Table/Type ในหน้าแนะนำ หน้าจอจริงมี Graph, DeepParse, Repair, DataBindingToggle, SideToggle และ Diff ด้วย

พัฒนาโดยใช้ [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview) และแพ็กด้วย [vsce](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) ดู license ของ dependency ใน `THIRD_PARTY_NOTICES.txt`
