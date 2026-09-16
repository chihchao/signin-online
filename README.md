# 課堂簽到系統（signin-online）

以 QR Code 為核心的課堂簽到系統。教師投影動態 QR Code，學生用 Google 帳號登入掃碼簽到；系統以 Firebase Authentication 驗證身分、Firestore 儲存資料、Firebase Hosting 部署，取代舊版 Google Apps Script（GAS）方案。

> 舊版 GAS 方案的踩坑紀錄與這次改寫的設計決策，見 [docs/gas-legacy-notes.md](docs/gas-legacy-notes.md)。

## 功能

### 教師端

- 建立/管理課程，並指定多位共同教師
- 投影頁顯示動態 QR Code，定期更新以防止截圖轉傳（`ProjectionView`）
- 自訂每堂課的出席狀態選項（如出席／請假／曠課等）
- 匯入與管理課程名冊（`CourseManager`）
- 查看每堂課的簽到紀錄，可手動調整學生出席狀態（`AttendanceRecordView`）
- 補登忘記點名的某一天：貼上「email,狀態」清單＋日期，一次匯入點名記錄（`AttendanceImportView`）
- 匯出出席紀錄為 CSV（`AttendanceExportView`）
- 刪除課程

### 學生端

- 用 Google 帳號登入後掃描 QR Code 完成簽到（`CheckinView`）
- 不在名冊內、簽到碼過期、重複簽到皆有即時明確提示
- 查詢個人在各課程的出席紀錄，僅限本人（`MyAttendanceView`）

## 技術棧

- **前端**：React 19 + TypeScript + Vite
- **身分驗證**：Firebase Authentication（Google 登入）
- **資料儲存**：Cloud Firestore，權限與防護邏輯寫在 [firestore.rules](firestore.rules)
- **託管**：Firebase Hosting
- **Lint**：Oxlint
- **測試**：Vitest（單元測試）＋ `@firebase/rules-unit-testing`（Firestore Security Rules 測試，需搭配 Firestore Emulator）

## 開始開發

### 環境需求

- Node.js（含 npm）
- [Firebase CLI](https://firebase.google.com/docs/cli)（`npm install -g firebase-tools`），需登入 `firebase login` 並可存取本專案的 Firebase 專案

### 安裝

```bash
npm install
```

### 環境變數

本地開發需要一份 `.env`，內容為 Firebase 專案的 Web App 設定（對應 [src/firebase/config.ts](src/firebase/config.ts) 讀取的 `VITE_FIREBASE_*` 變數）。請向專案管理者索取，或在 Firebase Console 的專案設定頁取得。

### 啟動開發伺服器

```bash
npm run dev
```

### 建置

```bash
npm run build
```

輸出至 `dist/`，對應 `firebase.json` 設定的 Hosting 目錄。

### 部署

```bash
firebase deploy
```

## 測試

```bash
npm test           # 單元測試 + Firestore Rules 測試
npm run test:unit  # 只跑單元測試（Vitest）
npm run test:rules # 只跑 Firestore Rules 測試（透過 Firebase Emulator 執行）
npm run test:watch # 監看模式
```

`test:rules` 會自動啟動 Firestore Emulator 執行測試，不需要另外手動啟動。

## Lint

```bash
npm run lint
```

## 資料模型（Firestore）

- `teachers/{email}`：教師白名單，email 為文件 ID
- `courses/{courseId}`：課程，含課程名稱、教師清單、自訂出席狀態選項
- `roster/{courseId}/students/{email}`：課程名冊
- `sessions/{sessionId}`：一次點名活動，`source` 欄位區分是「即時開課」（`live`，QR Code 對應的短效 session）還是「補登匯入」（`import`，回填過去日期、建立時即已結束）
- `attendance/...`：簽到紀錄

實際欄位與存取規則以 [firestore.rules](firestore.rules) 為準。

## 專案結構

```text
src/
  App.tsx                 應用程式入口，處理登入狀態與頁面切換
  CheckinView.tsx          學生掃碼簽到頁
  ProjectionView.tsx       教師投影頁（動態 QR Code）
  CourseManager.tsx        課程建立/設定/名冊管理
  AttendanceRecordView.tsx 簽到紀錄檢視與調整
  AttendanceImportView.tsx 補登指定日期的點名記錄（匯入）
  AttendanceExportView.tsx 出席紀錄 CSV 匯出
  MyAttendanceView.tsx     學生個人出席查詢
  firebase/                Firebase 初始化與各項資料服務（courses/roster/sessions/attendance/teachers）
docs/
  gas-legacy-notes.md      舊版 GAS 方案的需求沿革與踩坑紀錄
  agents/                  Agent 協作相關文件（issue tracker、triage 標籤等）
  specs/                   個別功能的設計規格文件
  superpowers/plans/       對應規格的實作計畫（任務拆解、測試步驟）
```

## 給協作 Agent 的說明

參見 [AGENTS.md](AGENTS.md)。
