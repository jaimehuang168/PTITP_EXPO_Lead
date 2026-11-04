# PTITP 展會訪客登錄

目前正式網站：https://jaimehuang168.github.io/PTITP_EXPO_Lead/

## 1.12.0 待啟用：Google 登入與活動掃描

本版本改用 Google 帳號登入。程式已準備，正式啟用仍待使用者同意建立登入用 Firebase 專案；未建立完成前，不得把這個版本視為正式上線。

- 西文操作介面，使用說明支援西班牙文與繁體中文。
- EXPO PBW：2026/11/10–11/14，America/Asuncion。手動登錄保留前後補登。
- 每筆登錄由後端驗證 Google 身分，寫入既有 Promotor 與新增的「Registrado por (email)」「Google UID」「Nombre de cuenta」。既有 Timestamp 作為建立時間；保留舊資料。
- 只有 jaimehuang168@gmail.com 可查閱、匯出、列印、產生 PDF/資料卡及手動寄送報告。後端以已驗證 Email 判斷。
- 所有已驗證的 Google 登入者在 PBW 期間自動取得掃描權限。伺服器以巴拉圭日期限制；期限外不會建立圖片或呼叫 AI。
- OCR 每日全團隊最多 300 次；最多輸出 500 tokens。沿用 Claude Haiku 4.5。
- OCR_ACCESS_TOKEN、REPORT_ADMIN_TOKEN 已由 Google 身分驗證取代；不再接受共用密鑰授權。ANTHROPIC_API_KEY 只保留後端。
- Google 登入使用分頁工作階段；待傳資料保留原 Google UID，不儲存 ID token。換帳號無法代送其他帳號的待傳。
- 舊版沒有 Google UID 的待傳資料不會被自動改名或刪除，需管理員確認。

費用與啟用範圍見 [PBW_2026_access_and_costs.md](docs/PBW_2026_access_and_costs.md)。

## 啟用流程

1. 取得同意後，建立 Firebase 專案 ptitp-expo-registro（免費 Spark），只啟用 Authentication 的 Google provider。
2. 註冊網頁 App，依 firebase.json 設定 Google 登入；確認 Authorized domains 包含 jaimehuang168.github.io 與該專案的 firebaseapp.com 網域。開發預覽僅在需要時暫時加入本機來源。
3. 在既有 Apps Script 的 Script Properties 設定 FIREBASE_PROJECT_ID 與 FIREBASE_WEB_API_KEY。這是 Firebase 公開網頁設定；私人 AI 金鑰不放入前端或 Git。
4. 選用：AUTH_ALLOWED_EMAILS 可用逗號、分號或空白列出允許的 Email，若設定須包含管理員。未設定則允許已驗證的 Google 帳號登錄。
5. 完成實際 Google 登入與一般使用者/管理員的驗證後，先更新原 Apps Script 部署的 Code.gs，再立即發布 GitHub Pages 的 index.html、google-session.js、version.json。
6. 核對公開 config 回應、正式前端版本、Google 登入成功及角色限制。Code_CRM.gs / Index_CRM.html 是其他部署，未修改。

公開 config 只傳回 Firebase 網頁設定與活動時段，不含私人密鑰或團隊允許名單。Google ID token 只經 HTTPS POST，Google accounts:lookup 驗證有效性，並檢查專案、issuer、期限、身分與已驗證 Email。

## 日常使用

同仁按「Continuar con Google」登入，姓名自動填入。填寫訪客、A/B/C 及追蹤工作後送出；等「Registrado ✔」確認。掃描辨識後仍須核對並按登錄。

連線不穩時先保存到同一瀏覽器，恢復後使用原帳號補傳。不要清除瀏覽器資料；未綁定帳號或資料驗證失敗的紀錄交由管理員確認。後端 ScriptLock 等待最多 30 秒，RequestID 去重並在成功前 flush。

報告寄送需管理員確認，收件人沿用 Config 的受控名單。自動報告日期/小時/觸發器另行管理，本次登入修改不會新增排程。

## 測試

```bash
npm install
npm test
```

包含 Google 身分與管理員權限、PBW 時間邊界、舊表遷移、8 個工作執行緒的並行寫入/重送、離線資料歸屬、憑證不落入待傳資料，以及既有報告/CRM 測試。這些測試不呼叫真實付費 OCR，也不取代正式 Google 登入的實測。
