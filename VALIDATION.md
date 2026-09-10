# ผลการตรวจ JSON Workbench 0.1.0

วันที่ตรวจ: 10 กันยายน 2026

| รายการ | ผล |
| --- | --- |
| `npm run check` | ผ่าน TypeScript type checking |
| `npm test` | ผ่าน 12 tests |
| `npm run test:ui` | ผ่าน 16 กลุ่มการใช้งานใน headless Chrome; ไม่มี browser error |
| `npm run package` | ผ่าน สร้าง VSIX ประมาณ 1.32 MB พร้อม JS/CSS/workers และ license notices |
| VS Code CLI install/list | ผ่าน ติดตั้ง VSIX ใน `test-results/installed-extensions` และพบ `local-tools.json-workbench-local@0.1.0` |
| `npm run test:vscode` | ยังตรวจไม่สำเร็จ: VS Code ของเครื่องปฏิเสธการเปิดเพราะ `Code is currently being updated` |

Logic tests ครอบคลุมเลขจำนวนเต็มใหญ่/ทศนิยมที่ต้องรักษาค่า, key เช่น `__proto__`, top-level primitives, indent ทุกแบบ, repair, stringify/unescape, deep parsing, JSON Pointer, table/tree pagination, sorting, ขอบเขต 100 MiB, share round trip และขอบเขตข้อมูลที่รับผ่าน bridge

UI tests ใช้ HTML/CSP และ bundled assets เดียวกับ extension ทดสอบการจัดรูปแบบทันที, Unicode, transformations, tree expansion, extraction, table, graph, type generation จาก worker จริง (TypeScript/Python/Go/JSON Schema), Monaco Diff, validation/repair, import/export bridge, share encoding, draft restore และการแสดง HTML-like JSON เป็นข้อความ

**ขอบเขตของหลักฐาน:** UI tests จำลอง VS Code message bridge สำหรับ file dialog, clipboard และ history จึงยังไม่ใช่หลักฐานว่าครบทุก flow ใน VS Code จริง การรับ input 100 MiB ผ่านที่ parser แต่ยังไม่ได้ทดสอบครบทุก UI view ด้วยไฟล์ 100 MiB การสร้าง Type ภาษาอื่นนอกเหนือจาก 4 ภาษาที่ระบุยังไม่ได้ตรวจ output แยกรายภาษา

ภาพหน้าจออยู่ใน `test-results/workbench-dark.png`, `test-results/workbench-light.png` และ `test-results/workbench-narrow.png` ผล UI แบบ machine-readable อยู่ใน `test-results/ui-results.json`

หลัง VS Code อัปเดตเสร็จ สามารถรัน `npm run test:vscode` ซ้ำได้ ใช้ profile ทดสอบใน `test-results/vscode-profile` โดยไม่เปลี่ยน settings ของ profile ปกติ
