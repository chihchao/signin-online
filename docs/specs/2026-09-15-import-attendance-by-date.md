# 匯入點名記錄（補登指定日期）— 規格

**狀態**：已與使用者確認（2026-09-15，透過 grill-me 逐題討論定案）
**目的**：在課程設定頁新增功能，讓老師可以補登「忘記點名的某一天」的出席狀態。

## 1. 情境與範圍

老師某一天用紙本點名（或其他方式），事後要把結果補登進系統。這**不是**用來取代即時點名（QR 掃碼簽到），也不處理跨系統匯出/匯入格式轉換——只處理「老師手上已經有一份 email+狀態的清單，要一次寫進系統」這件事。

## 2. UI

### 2.1 位置

課程設定頁（`CourseSettings`，`src/CourseManager.tsx`）的 `.settings-grid` 裡新增一張獨立 `.panel`卡片「匯入點名記錄」，放在選課名單（`RosterManager`）與點名記錄匯出（`AttendanceExportView`）附近。

### 2.2 欄位與流程

- 一個「日期」欄位（`<input type="date">`，上限為今天——不能匯入未來日期）。
- 一個文字框，貼上內容，一行一筆：`email,狀態文字`。狀態文字必須跟這門課**目前畫面上顯示**的出席狀態選項文字完全相同（見 §4.3）。
- 一個「匯入」按鈕。**沒有預覽步驟**：按下去就直接送出、驗證、寫入，完成後顯示結果。

### 2.3 結果呈現

- **驗證失敗**（見 §3 的「整份擋下」情況）：不寫入任何資料，顯示每一行的行號、原始內容、錯誤原因的清單，要老師修正後重新整份貼上再送出一次。
- **驗證通過但有查無學生的行**（見 §3 的「單行跳過」情況）：正常寫入其餘記錄，額外列出「以下 email 不在選課名單中，已略過」的清單。
- **成功**：顯示「成功匯入 N 筆」。

## 3. 驗證規則

貼上內容以 `\r?\n` 分行處理。**空白行一律忽略**，不算錯誤、不影響其他規則的判斷。

對每一個非空白行，依序檢查：

| 情況 | 判定 | 處理方式 |
|---|---|---|
| 該行不是合法的 `email,狀態文字`（沒有逗號、email 或狀態文字為空、email 格式不合法） | 格式錯誤 | **整份匯入擋下**，不寫入任何資料 |
| 狀態文字不等於這門課目前任何一個狀態選項的顯示文字 | 狀態不合法 | **整份匯入擋下**，不寫入任何資料 |
| 同一個 email（正規化後，大小寫、前後空白視為相同）在這次貼上內容中出現超過一次 | 重複 email | **整份匯入擋下**，不寫入任何資料 |
| 通過以上三項檢查，但 email 在課程目前的選課名單中找不到對應學生 | 查無學生 | **只跳過該行**，其餘正常寫入，結果報告列出 |

「整份擋下」的三種錯誤是**互斥的判斷順序**（先看格式、再看狀態、才看重複），但**同一次送出裡三種錯誤可以同時出現在不同行**——只要有任何一行落入前三種情況，整份就不寫入，結果畫面把所有問題行（不限單一種類）一次列出來，讓老師一次修正完再重送。「查無學生」永遠是最後一關，且不會讓其他行連坐失敗。

## 4. 資料寫入方式

### 4.1 Session：每次匯入都建立一支全新的 session

**不**比對、**不**合併「當天是否已有其他 session」——每次成功匯入永遠新建一支 session 承載這次的記錄。

- 只有在「至少有一行通過驗證且在名冊裡找得到學生」時才建立這支 session；如果驗證通過但每一行都因為查無學生被跳過，則不建立任何 session（避免留下空的、沒有任何記錄的 session）。
- `session.createdAt` = 老師選的日期 + 固定時間 **12:00（當地時間中午）**。選中午而不是 00:00，是為了避免時區轉換（Firestore 以 UTC 存 Timestamp，前端用本地時區顯示）把日期誤判成前一天或跨日界線。
- `session.endedAt` = 與 `createdAt` 相同的值（建立當下就視為已結束）。這支 session 不會以「進行中」的樣子出現在其他畫面（例如 QR 投影頁面、目前點名活動列表），也不會被 `endSession()` 的自動缺席邏輯或任何「恢復進行中 session」的邏輯碰到。
- `session.createdBy` = 執行匯入的老師 email。
- `session.source` = `'import'`（即時「開始點名」建立的 session 則是 `'live'`）。因為匯入的 session 建立時就已經是 `endedAt` 非 null 的狀態，跟一支「已經結束的即時點名」在資料形狀上會完全一樣，光看 `createdAt`/`endedAt` 沒辦法分辨兩者；`source` 讓 `出席紀錄` 畫面的 session 下拉選單可以把同一天的「補登」跟「即時點名」標示清楚（例如「2026-01-05（補登）」）。這個欄位是這次才新增的，舊資料沒有這個欄位，讀取時一律預設成 `'live'`（在此之前系統只有即時點名一種 session）。
- 匯入 session 建立時**不**經過 `activeSessions/{courseId}` pointer（那個 pointer 只給「開始點名／恢復點名」用），避免污染即時點名的恢復邏輯。
- 建立 session 之後，寫入點名記錄的批次若失敗（例如前端手上的狀態選項跟課程實際的 `customStatuses` 不同步，導致 Firestore 規則拒絕某筆狀態），會自動刪除已經建立的 session、以及這次匯入已經成功寫入的任何點名記錄，讓失敗的匯入不會留下「查無記錄的孤兒 session」——維持跟「全部跳過就不建立 session」一致的保證：一個 session 存在，就代表它底下至少有一筆有效記錄。此清理是 best-effort：清理本身若又失敗，會吞掉清理的錯誤，讓老師看到的還是原始的寫入失敗原因，而不是被清理失敗蓋掉。
- **批次大小是依 Firestore 規則的讀取成本訂的，不是依「一個批次最多 500 個寫入」訂的**：每一筆點名記錄寫入時，`isValidTeacherAttendanceCreate` 規則都要額外查課程、session、名冊共 3 份文件；Firestore 對「一個批次裡，規則評估總共可以查幾次關聯文件」另外有一個遠比 500 小的上限（20 次）。實際上線後，一次匯入 53 筆（53×3=159 次查詢）就整批被 Firestore 拒絕，回傳籠統的權限錯誤——這是這個功能第一次正式上線後才發現的真實案例，不是理論上的邊界情況。因此點名記錄的寫入批次改成每批 5 筆（5×3=15 次查詢，留一點安全餘裕），`endSession()` 的自動缺席批次寫入、`importRoster()` 的名冊批次寫入也是同樣的問題（只是每筆查詢次數不同），一併修正為對應各自查詢成本的批次大小。本地 Firestore Emulator 不會真的落實這個 20 次上限（只會評估得比較慢，不會直接拒絕），所以這個限制沒辦法單靠自動化測試在本地重現，只能靠推理批次大小、並在正式環境驗證。

### 4.2 attendance 記錄

每一筆通過驗證且在名冊裡找到對應學生的行，寫入一筆 `attendance/{sessionId}_{studentEmail}` 文件：

```
{
  sessionId,       // 這次匯入新建的 session id
  courseId,
  studentEmail,    // 正規化後（trim + lowercase）的 email
  status,          // 對應到的內部狀態值，見 §4.3
  timestamp,       // 與 session.createdAt 相同：老師選的日期 + 12:00
}
```

因為 sessionId 是全新建立的，`{sessionId}_{studentEmail}` 這組 doc id 天生不會跟任何既有記錄衝突（無論是學生自己刷卡的、或是之前其他 session 的補登記錄）——不需要額外的「覆蓋 vs 略過」判斷。

### 4.3 狀態文字對應

課程目前的狀態顯示文字，依 `orderedStatusOptions()`（`src/attendanceStatusLabels.ts`）的順序是：

```
[ statusLabel('present'), ...course.customStatuses, statusLabel('absent') ]
```

`statusLabel('present')` / `statusLabel('absent')` 目前對應中文「出席」「缺席」；`customStatuses` 本身的字串就是顯示文字，同時也是要寫入 `attendance.status` 的內部值。

匯入時的比對／轉換表（老師輸入的顯示文字 → 寫入的內部值）：

- `出席` → `present`
- `缺席` → `absent`
- 每一個 `customStatuses` 裡的字串 → 該字串本身

不在這個對照表裡的文字，一律視為「狀態不合法」（§3）。

## 5. 安全規則（`firestore.rules`）異動

現況：`sessions` 的 `allow create` 規則要求 `createdAt == request.time` 且 `endedAt == null`，**完全不允許**回填過去日期、也不允許建立時就標記已結束。這與 §4.1 的需求衝突，**必須修改規則**才能實作。

已與使用者確認的方案：拆成「即時開始點名」與「匯入建立」兩種允許的寫入形狀，用 `||` 並存：

```
function isValidLiveSessionCreate() {
  return request.resource.data.createdAt == request.time &&
    request.resource.data.endedAt == null;
}

function isValidImportSessionCreate() {
  return request.resource.data.createdAt is timestamp &&
    request.resource.data.createdAt <= request.time + duration.value(1, 'd') &&
    request.resource.data.endedAt == request.resource.data.createdAt;
}

match /sessions/{sessionId} {
  allow create: if isTeacherOfCourse(request.resource.data.courseId) &&
    request.resource.data.createdBy == request.auth.token.email &&
    (isValidLiveSessionCreate() || isValidImportSessionCreate());
  ...
}
```

`isValidImportSessionCreate()` 允許 `createdAt` 不晚於「現在 + 1 天」的時間戳記，且要求 `endedAt` 必須等於 `createdAt`（不能留下一個「進行中但日期是過去」的怪狀態）。

這個 1 天容許值是最終審查時抓到的實際 bug 修正，不是預防性設計：`attendanceImportService.ts` 把匯入 session 的 `createdAt` 固定設成所選日期「當天中午 12:00」；若教師回填的是**今天**、且在中午 12:00 之前送出匯入（例如上午 10 點的課、10:30 補登），送出的 `createdAt` 會比 `request.time` 還晚，若規則只允許 `createdAt <= request.time`，這個「回填當天」的核心情境反而會被 Firestore 規則擋下、丟出教師看不懂的權限錯誤。加上 1 天的容許值後，「今天中午 12:00」無論教師實際是在當天的哪個時間點送出都一定能通過，同時仍然會擋下真正的未來日期（明天以後）。

其餘 `sessions` 的規則（`update`／`delete`／`tokens` 子集合）**不需要修改**——`update` 規則要求 `resource.data.endedAt == null` 才能結束，匯入建立的 session 一開始 `endedAt` 就非 null，天生無法被 `endSession()` 二次結束，符合預期（它本來就不該被當成一個可以再操作的 session）。

`attendance` 集合的規則**不需要修改**：`isValidTeacherAttendanceCreate()` 本來就允許教師以任意 `timestamp`（非 `request.time`）建立記錄，本來就是為手動補登設計的。

## 6. 明確排除的範圍（YAGNI）

- 不支援檔案上傳／CSV 解析——沿用貼上文字框，跟既有的「匯入名冊」一致。
- 不做匯入前的預覽確認畫面。
- 不做「狀態文字模糊比對」或「匯入前手動對應狀態」的介面——嚴格比對顯示文字。
- 不自動把找不到的學生加進名冊——名冊異動只透過既有的「匯入名冊／新增學生」完成。
- 不檢查/提醒「當天是否已經匯入過」——每次匯入都是獨立的一支新 session，重複匯入由老師自己負責。
