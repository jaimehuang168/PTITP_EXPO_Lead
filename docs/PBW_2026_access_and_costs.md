# EXPO PBW 2026：登入、掃描權限與費用試算

狀態：登入專案 `ptitp-expo-registro` 已建立，Google provider 與網站來源已設定，已確認未啟用付費計費。1.12.0 部署驗證中。

## 已確定的行為

- 操作介面以西班牙文為主；使用說明保留繁體中文切換。
- 每位同仁使用自己的 Google 帳號登入；伺服器驗證身分後，自動記錄登錄者姓名、Email、Google UID 與既有建立時間。
- 暫時開放已驗證的 Google 帳號登錄；若之後提供團隊名單，可透過 `AUTH_ALLOWED_EMAILS` 限定。
- 只有 `jaimehuang168@gmail.com` 可查看報表、匯出 PDF、輸出客戶資料卡、列印及手動寄送報表。後端逐次驗證身分。
- 登入後自動取得名片掃描權限，不再要求同仁輸入 `OCR_ACCESS_TOKEN`。舊掃描密鑰與舊主管密鑰都不再提供權限。
- 掃描開放時間：**巴拉圭時間 2026/11/6 00:00:00 至 2026/11/14 23:59:59**。含 11/6 起的訓練期間；正式 EXPO PBW 統計日期仍為 11/10–11/14。UTC 對應 11/6 03:00:00 至 11/15 02:59:59。11/15 00:00:00 起自動關閉掃描。
- 手動登錄仍可於活動前後補登，但需登入。
- 全團隊每日最多 300 次掃描請求；開放 9 天最多 2,700 次。重拍或重試也計入次數。
- 待傳紀錄保留原帳號 UID，只由原帳號補傳；登入憑證不寫入待傳資料。舊版未綁定帳號的待傳紀錄保留供管理員確認。

## 試算基礎（2026/11/04 查價，美元）

沿用現有 `claude-haiku-4-5`。官方標準價格為每百萬輸入 tokens US$1、輸出 tokens US$5。現有程式將圖片長邊壓至 1,280 px，單次最多輸出 500 tokens。

這裡以兩種工作量假設試算，並非實際測量：

| 假設 | 每張輸入 tokens（含圖片及提示） | 每張輸出 tokens | 每張估算 |
|---|---:|---:|---:|
| 一般名片 | 1,500 | 250 | US$0.00275 |
| 較保守規劃 | 2,500 | 500 | US$0.00500 |

公式：`輸入 tokens × 1 / 1,000,000 + 輸出 tokens × 5 / 1,000,000`。

以下將每日掃描量套用於 11/6–11/14 的 9 天；實際訓練只掃少量時，費用會更低。

| 團隊人數 | 每人每天掃描 | 9 天總次數 | 一般估算 | 保守估算 |
|---:|---:|---:|---:|---:|
| 6 | 10 | 540 | US$1.49 | US$2.70 |
| 8 | 10 | 720 | US$1.98 | US$3.60 |
| 6 | 20 | 1,080 | US$2.97 | US$5.40 |
| 8 | 20 | 1,440 | US$3.96 | US$7.20 |
| 6 | 30 | 1,620 | US$4.46 | US$8.10 |
| 8 | 30 | 2,160 | US$5.94 | US$10.80 |
| 全團隊每日達 300 次上限 | — | 2,700 | US$7.43 | US$13.50 |

建議本次活動先預留 **US$20 的 OCR 規劃預算**。每日 300 次限制是請求次數上限，並非美元硬上限；實際費用依圖片、輸出、失敗請求是否計費及供應商帳單而定。以上未含稅。

Google 登入使用 Firebase Authentication 的免費 Spark 方案，6–8 位使用者的規模預估新增登入費用 US$0。登入專案只設定 Authentication；不啟用付費升級、資料庫或新的圖片儲存服務。名片仍使用既有 Google Drive 空間；若平均每張壓縮後 0.3 MB，2,700 張約占 810 MB，現有帳號剩餘容量尚未核對。

## 部署設定

登入專案為 `ptitp-expo-registro`（PTITP EXPO Registro），Google 登入來源包括正式 GitHub Pages 網域。Apps Script 以公開 Firebase 專案參數連接；正式 AI 金鑰保留在既有後端。前端需更新到 1.12.0 才能使用登入流程。

## 官方依據

- [Claude 模型價格](https://platform.claude.com/docs/en/about-claude/pricing)
- [Claude 圖片處理說明](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Firebase 免費方案及驗證價格](https://firebase.google.com/pricing)
- [Firebase Google 登入](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase Auth REST：取得使用者資料](https://firebase.google.com/docs/reference/rest/auth#section-get-account-info)
- [Firebase JavaScript SDK 官方 CDN](https://firebase.google.com/docs/web/alt-setup#from-the-cdn)
