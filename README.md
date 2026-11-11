# PTITP 展會訪客登錄

目前正式網站：https://jaimehuang168.github.io/PTITP_EXPO_Lead/

## 1.18.1：參訪報名按鈕

- 參訪海報的縮圖與放大畫面下方提供 **Inscribirme en la visita**，原海報上的 QR Code 也可繼續使用。

## 1.18.0：離線使用與客戶登錄

- 出發前用 Google 登入、選好活動，再按 **Preparar sin conexión**。看到材料及登錄已備妥後，同一手機和瀏覽器可離線開啟 App、兩份 PDF、展示圖及地圖。
- 斷線時手動填寫並按 **Guardar en el dispositivo**。待傳資料儲存在手機，重新開啟仍保留。恢復網路並使用原帳號時自動補傳，Google Sheets 確認後才移除待傳紀錄。
- 初次準備及 Google 登入需要網路。帳號失效時需用原帳號重新登入。活動結束後仍待傳的資料由管理員依既有流程處理。

## 1.17.0：分享園區簡報 PDF

- **Materiales** 提供西文及巴西葡文原始 PDF，可預覽或下載。**Presentación** 內可直接前往。
- 支援檔案分享的手機可先按 **Preparar PDF**，備妥後按 **Compartir PDF**，再依系統選單使用 Bluetooth、Quick Share 或 AirDrop。也可下載後從手機的「檔案」分享。
- 展示入口：`#materiales`。首次準備選定的 PDF 需要網路。

## 1.16.0：訪客展示分頁

- **Presentación** 分頁提供 7 張原始宣傳圖，可直接按 **Comenzar presentación**，或點選特定主題。
- 看圖畫面可前後切換、放大、縮小、還原整張；放大後可滑動查看文字及 QR。鍵盤左右鍵切換，Esc 或 Cerrar 關閉並回到原按鈕。
- 原圖與 QR 像素完整保留。PBW 宣傳圖的日期依原圖展示；活動預設、登錄、OCR 與管理員規則沿用既有後端。
- 切換展示分頁保留未送出的登錄草稿。可使用 `#presentacion` 連結直接開啟展示分頁；手機導覽列可橫向滑動，所有分頁仍可使用。
- 只需發布前端與 assets/presentation 內的 7 張 JPEG；後端仍為 1.15.0。

## 1.15.0：最新活動預設，歷史活動僅限後臺補登

- 一般連結自動選擇正式開始日期最新且可用的活動；相同日期則取較後新增者。已取消手動指定預設活動。
- 採巴拉圭時間，正式結束日 23:59:59 後，一般登錄停止；沒有已知日期的歷史活動同樣關閉。活動前及訓練期間仍可手動登錄。
- 管理員到 **Reportes → 選擇活動 → Cargar desde administración** 才能補登；畫面會標示後臺模式。可選填實際接觸日期，報表使用該日期，Timestamp 仍保留真實輸入時間；留空則使用今天。
- 伺服器驗證管理員身分及補登模式，一般帳號不能以直接呼叫繞過。歷史活動 OCR 關閉。已確認的重送照常回覆成功；未確認的歷史待傳保留，交由管理員處理。
- 已封存活動須先由管理員重新啟用，再從後臺補登；歷史報表始終保留。頁面說明與版本化資源同步更新。

## 1.14.0：同一份 Google Sheet，多場活動

- 活動設定保存在既有試算表的 `Eventos` 分頁；每筆新登錄增加固定 `Evento ID`，舊資料保留原樣。
- 管理員登入後，到 **Reportes → Administrar actividades → Nueva actividad** 填寫名稱與正式日期並儲存，再複製活動專屬連結給團隊。每屆活動請新增一筆，即使名稱相同也會分開統計。
- 一般連結開啟管理員指定的預設活動；`?evento=<ID>` 固定開啟指定活動。無效或封存連結會要求另選活動。
- 新活動預設關閉付費名片掃描。管理員開啟後可另設訓練／活動掃描期間，採巴拉圭時間；所有活動共用每日 300 次限制。PBW 原設定維持正式 11/10–11/14、掃描 11/6–11/14（2026）。
- 報表依活動 ID 區分；「Ver período oficial」只計算正式日期，「Todo el evento」包含訓練及補登，另保留全部歷史資料選項。活動結束後的輸入規則以 1.15.0 為準。
- 切換活動前會確認未送出的草稿；待傳資料保留原活動及原帳號。封存停止新登錄，既有報表保留；尚未確認的待傳須重新開放活動後補傳，已確認的重送仍安全回覆成功。
- 編輯設定會檢查版本，避免另一個管理員分頁覆蓋新設定。出現衝突時，保留必要內容後按「Recargar actividades」再編輯。
- 先更新既有 Apps Script 部署並執行一次 `setup()`，建立活動目錄及附加欄標題；再一起發布前端 HTML、CSS、mobile-ui.js、event-ui.js、google-session.js、version.json。初始化不新增訪客、掃描、郵件或觸發器。

## 1.13.0：手機優先登錄介面

採用已確認的手機設計：深綠存檔、深藍掃描及導覽、統一 IBM Plex Sans、18px 輸入文字、52px 欄位與固定底部「Guardar y continuar」。登入後以頁首帳號按鈕查看 Email 或登出。

- 常用聯絡資料優先；其他聯絡、組織及追蹤資料可展開，保留所有既有欄位。
- 土地與標準廠房分開勾選，選取後展開面積與時程；收合不會清除資料。
- Registro、Materiales、Ayuda，以及管理員專用 Reportes；原 QR、地圖及中西文教學完整保留。
- 存檔與名片辨識互相鎖定，避免兩個流程交錯；登出或更新前會檢查包括 Email 在內的未送出資料。
- 只有伺服器確認後才顯示已存入 Google Sheets；待傳仍保留原帳號歸屬。Google 驗證、OCR 日期／額度及後端權限沿用 1.12.0，本次不用重新部署 Apps Script。
- 發布時需一起更新 index.html、mobile.css、mobile-ui.js、version.json；google-session.js 保持原邏輯。

## 1.12.0：Google 登入與活動掃描

本版本改用 Google 帳號登入。登入專案為 ptitp-expo-registro，使用免費 Spark 方案。

- 西文操作介面，使用說明支援西班牙文與繁體中文。
- EXPO PBW：2026/11/10–11/14，America/Asuncion。手動登錄保留前後補登。
- 每筆登錄由後端驗證 Google 身分，寫入既有 Promotor 與新增的「Registrado por (email)」「Google UID」「Nombre de cuenta」。既有 Timestamp 作為建立時間；保留舊資料。
- 只有 jaimehuang168@gmail.com 可查閱、匯出、列印、產生 PDF/資料卡及手動寄送報告。後端以已驗證 Email 判斷。
- 所有已驗證的 Google 登入者在 2026/11/6–11/14 自動取得掃描權限，包含 11/6 起的訓練；正式活動統計仍為 11/10–11/14。伺服器以巴拉圭日期限制；期限外不會建立圖片或呼叫 AI。
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
