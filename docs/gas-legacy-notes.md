# 課堂 QR Code 簽到系統 — React + Firebase 重寫需求

> 這份文件記錄「另開新專案」時要沿用的需求與技術決策，來源是 `signin-online`（GAS 版本）這個專案的完整討論與踩雷紀錄。新專案要解決 GAS 版本在帳號切換體驗上的根本限制（GAS Web App 平台層會強制未登入請求導向 Google 登入頁，導致外部前端 + `fetch()` 呼叫 GAS 不可行——見文末「GAS 版本踩過的坑」）。

## 技術棧

- **前端**：React（建議用 Vite 建置）
- **身分驗證**：Firebase Authentication，Google 登入（`signInWithPopup` / `GoogleAuthProvider`）
- **資料儲存**：Firestore
- **託管**：Firebase Hosting（跟 Auth/Firestore 同生態系，比另外找地方架站自然）

## 功能需求（沿用自 GAS 版本）

1. **教師端（投影頁）**
   - 教師登入後輸入課程/日期名稱（無則新建、已存在則沿用），畫面顯示動態 QR Code
   - QR Code 每 15 秒更新一次（防止學生截圖轉傳給不在場的人簽到）
   - 只有白名單內的教師 email 可以開啟此頁、產生簽到碼

2. **學生端（簽到頁）**
   - 用 Google 帳號登入，顯示目前登入的帳號
   - 帳號不對時可切換（Firebase Auth 的 Google 登入原生就有「選擇帳戶」彈窗，不需要像 GAS 版本那樣搞無痕視窗/瀏覽器頭像切換的替代方案）
   - 送出簽到後即時顯示成功/失敗訊息（例如：帳號不在名冊、簽到碼過期、已重複簽到）
   - 必須在「名冊」中才能簽到成功，否則明確告知「請切換帳號」
   - 同一堂課同一天不可重複計入（可重複送出但只顯示已完成訊息）

3. **學生自查頁**
   - 登入後只能查詢自己的出席紀錄（不接受查詢他人，也不需要輸入學號）
   - 顯示每堂課的出席/缺席狀態

## 資料模型建議（Firestore）

- `roster/{email}`：學生名冊，欄位含學號、姓名（email 當文件 ID，方便用 `request.auth.token.email` 直接比對權限）
- `teachers/{email}`：教師白名單（同上，email 當文件 ID）
- `sessions/{sessionId}`：教師開課時建立，欄位含 `course`（課程/日期名稱）、`createdAt`（`serverTimestamp()`）、`createdBy`（教師 email）
- `attendance/{sessionId}_{studentEmail}`（或子集合 `sessions/{sessionId}/attendance/{studentEmail}`）：簽到紀錄，欄位含 `studentEmail`、`timestamp`（`serverTimestamp()`）、`userAgent`

## 安全機制設計（取代 GAS 版本的 HMAC 動態碼）

GAS 版本用「HMAC-SHA256(step_course, SECRET_KEY)」自製防截圖轉傳機制。Firestore 版本改用**伺服器端時間戳記 + Security Rules**，更簡單也更可靠：

- QR Code 只需編碼 `sessionId`（不需要 step/token 這些自製簽章）
- 學生寫入 `attendance` 文件時，Security Rules 檢查：
  - `request.auth.token.email` 必須存在於 `roster` collection
  - 寫入的 `timestamp` 必須是 `request.time`（伺服器時間，學生端無法偽造）
  - 對應的 `sessions/{sessionId}.createdAt` 必須在合理時間窗內（例如 30~45 秒內），超過就代表 QR 已經換過、這個 sessionId 過期作廢——**但注意：這個模式下 QR 換的是「新的 sessionId」還是「同一個 sessionId 但用短時效重新整理」需要再設計，因為原本 GAS 版本是同一個 course 用不同 step 產生新 token；Firestore 版本若也想維持「QR 每 15 秒真的换一码」的效果，可以讓教師端每 15 秒建立一筆新的短效 session 文件，QR 編碼最新的 sessionId**
- `sessions` 只有 `teachers` collection 內的 email 能建立（Security Rules 檢查 `request.auth.token.email` 存在於 `teachers`）
- 防重複簽到：Rules 或 transaction 檢查同一 `studentEmail` + 同一天/同一 course 是否已有紀錄

## 待確認的開放問題（下一個專案開工前要先問使用者）

1. **要不要保留 Google 試算表報表？** 若要，資料仍要有辦法匯出/同步到 Sheets（例如排程 Cloud Function，但這會需要升級 Firebase Blaze 付費方案；若不需要 Cloud Functions，可以完全留在免費 Spark 方案）
2. **要不要做頁面內攝影機掃碼？** 這個架構下可行（不再被 GAS 的 iframe 沙盒擋住 `getUserMedia()`），但目前 GAS 版本是靠手機原生相機 App 掃碼後開瀏覽器，兩種體驗要選一種
3. Firestore 免費方案（Spark）額度是否足夠——以一般班級規模的簽到頻率，理論上綽綽有餘，但正式上線前建議抓量估算一次

## GAS 版本踩過的坑（新專案要避開的教訓）

- **GAS Web App 平台層會強制未登入的請求導向 `accounts.google.com` 登入頁**（即使 `access: ANYONE`），這是 Google 平台限制、不是我們程式碼可以繞過的東西。這代表「外部前端 + `fetch()` 呼叫 GAS Web App 當純 API」在真實情況下不可靠（尤其 Safari/iOS 預設擋第三方 cookie），是這次放棄外部前端方案、改考慮 Firebase 的直接原因
- GAS 的 `HtmlService` 模板編譯器是用純文字掃描整份檔案找 `<?...?>`，**不會理會這是不是寫在 JS 註解裡**——連續踩過兩次「註解裡寫到 `<?...?>` 樣式的說明文字，被誤判成要執行的程式碼」的坑
- GAS 網頁應用程式的實際內容是跑在多層巢狀的 cross-origin iframe 沙盒裡（`script.google.com` 外層 → `sandboxFrame` → `script.googleusercontent.com` 內層），`window.location.href` 讀到的不是外部看到的真實網址
- 該 iframe 沙盒的 `allow` 屬性**沒有 `camera`/`microphone`**，所以 GAS 網頁內無法用 `getUserMedia()` 開攝影機
- `google.script.run` 序列化「物件陣列」（array of objects）不穩定，會被轉成無法解析的 Java 物件參照；改用平行的純值陣列（字串陣列 + 布林陣列）才穩定
- Google 試算表看到像「2026-09-09」這種文字，會自動判讀成日期格式儲存，導致後續字串比對失敗；寫入時要強制設 `setNumberFormat("@")` 純文字格式
- Google 對「continue 參數導回 script.google.com/googleusercontent.com」這類跳轉持續加強防護（AccountChooser、ServiceLogin 都先後被擋），`/u/N/` 路徑切換帳號則是對 Google Workspace 網域帳號的路由行為不穩定——這些都是 GAS 版本最終改用「瀏覽器原生帳號切換」而非自製切換機制的原因，Firebase Auth 版本因為用戶端 SDK 是正規 OAuth 流程，不會有這些問題
