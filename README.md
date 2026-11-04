# PTITP 展會招商問卷系統（Sistema de Captación de Leads）

Google Sheet 當資料庫 + Apps Script 當 API + GitHub Pages 當前端。
推廣人員用手機開連結填問卷 → 自動寫入 Sheet → 可依設定產生西文當日業務報告。

目前活動為 **EXPO PBW，2026-11-10 至 2026-11-14（America/Asuncion）**。保留活動前後補登；報告預設只看 EXPO PBW，也可選舊展會或全部歷史。「Todo el evento」含補登資料，「Rango de fechas」預填 11/10–11/14。

## 架構

```
手機/平板 (GitHub Pages: index.html)
        │  fetch POST (JSON, text/plain 避開 CORS preflight)
        ▼
Apps Script Web App (Code.gs: doPost)
        │  appendRow
        ▼
Google Sheet「Leads」──▶ generarReporteDiario() ──▶「Reportes」分頁 + Email
```

## 部署步驟（約 15 分鐘）

### A. Google Sheet + Apps Script 後端

1. 建立新的 Google Sheet，命名如 `PTITP_Expo_Leads`。
2. 「擴充功能 → Apps Script」，刪除預設內容，貼上 `Code.gs` 全文。
3. 修改頂部 `CONFIG`：
   - `REPORT_EMAIL`：每日報告收件人（可留空、可多個逗號分隔）
   - `EVENTO_DEFAULT`：預設展會名稱
4. 執行一次 `setup()`（第一次會要求授權），建立 `Leads` 與 `Reportes` 表頭。
5. 在「專案設定 → 指令碼屬性」新增 `REPORT_ADMIN_TOKEN`，值使用至少 16 字元的隨機密鑰。這把密鑰只提供給主管，用於保護報告、PDF、資料卡與手動寄信功能；不可寫入 `index.html` 或提交到 Git。
6. 如啟用名片辨識，在同一處設定 `ANTHROPIC_API_KEY` 及獨立的 `OCR_ACCESS_TOKEN`（至少 16 字元隨機值）。掃描密鑰可提供給現場同仁，**不得與主管密鑰相同**；同仁在「Configurar escaneo de tarjetas」輸入，僅留在分頁 sessionStorage。未設定時掃描關閉，人工登錄仍可使用。不要將任何真實密鑰寫入原始碼或 Git。
7. 如另有授權啟用自動寄信，設定 Config 的起訖日期、收件人與小時後執行 `crearTriggerDiario()`。這是每小時檢查的觸發器，不保證固定分鐘。本次登錄期間設定不會自動啟動寄信。
8. 「部署 → 新增部署作業 → 網頁應用程式」：
   - 執行身分：**我**
   - 具有存取權的使用者：**所有人**（前端匿名 POST 必須如此）
9. 複製產生的 Web App URL（結尾是 `/exec`）。每次修改 `Code.gs` 後，都要建立新版本並更新既有部署。

### B. 前端（GitHub Pages）

1. 打開 `index.html`，把 `const API_URL = 'PEGAR_AQUI...'` 換成上一步的 `/exec` URL。
2. 建立 GitHub repo（如 `ptitp-expo-leads`），只需放 `index.html` 一個檔案：
   ```
   git init; git add .; git commit -m "PTITP 展會問卷系統 v1"
   git branch -M main
   git remote add origin https://github.com/jaimehuang168/ptitp-expo-leads.git
   git push -u origin main
   ```
3. Repo → Settings → Pages → Source 選 `main` / root → Save。
4. 幾分鐘後取得網址：`https://jaimehuang168.github.io/ptitp-expo-leads/`
   把這個連結（或做成 QR code 貼在攤位內側）發給推廣人員即可。

### C. 每日報告的三種取得方式

| 方式 | 操作 |
|---|---|
| 自動 Email | 另行設定 Config 日期、小時、收件人及觸發器後寄出 |
| Sheet 選單 | 打開 Sheet →「📋 PTITP Expo → Generar reporte de hoy」 |
| 網頁查看 | 在前端「Reportes」區輸入主管密鑰後以 POST 開啟；舊的帶 token 報告連結已停用 |

## 前端功能重點

- **內建使用說明**：上方「Guía / 說明」分頁提供西班牙文與繁體中文切換，包含首次登錄、掃描密鑰位置、評級及標準廠房需求、斷線補傳、多人協作與主管報告。`#guia` 可直接開啟說明；從說明返回表單保留未送出的內容。
- **活動一致**：各裝置預填 EXPO PBW，避免沿用舊展會名稱；推廣員姓名可留存在該裝置。
- **離線佇列**：先逐筆保存，再送出；只刪除已確認成功的紀錄。恢復連線或每 30 秒重送待傳資料。同頁不會同時啟動兩次重送，跨頁重送由後端 RequestID 去重。收到成功訊息前，請保留原瀏覽器資料。
- **6–8 人輸入**：後端以 ScriptLock 序列化寫入、等待最多 30 秒，並於釋放前 flush。測試以八個工作執行緒模擬同時寫入與重試；正式 Google 服務及展場網路的延遲仍需現場演練。參考 [Google Lock 文件](https://developers.google.com/apps-script/reference/lock/lock)。
- **A/B/C 快速分級**：大按鈕含判斷標準提示（A = 有具體專案 + 決策權）。
- **必填最少化**：只有姓名 + 分級 + 展會/推廣員為必填，30 秒可完成一筆。

## 後續追蹤（展後作業）

`Leads` 表最後一欄 `Estado` 供追蹤用，手動更新：`Pendiente → En proceso → Cerrado`。
建議展後第一週流程：A 級 24-48 小時內聯繫 → B 級一週內寄資料 → C 級加入 newsletter。
可另建篩選檢視（Filter View）依 `Calificación` + `Estado` 過濾出待辦清單。

## 常見問題

- **送出後顯示「Sin conexión」但網路正常** → 檢查 `API_URL` 是否為 `/exec` 結尾、部署權限是否為「所有人」。
- **改了 Code.gs 沒生效** → Apps Script 要「部署 → 管理部署作業 → 編輯 → 新版本」才會更新 `/exec`。
- **報告顯示「No autorizado」** → 確認頁面輸入的主管密鑰與指令碼屬性 `REPORT_ADMIN_TOKEN` 完全一致；密鑰只保留在目前瀏覽器分頁的 sessionStorage。
- **時區** → 全部以 `America/Asuncion` 計算，`CONFIG.ZONA_HORARIA` 可改。

## 本機測試

```bash
npm install
npm test
```

測試涵蓋公開問卷、報告授權、受控收件人、公式注入防護、輸入驗證、並行鎖、離線重送去重、OCR 配額及 CRM 功能。

## 1.11.0 發布順序與限制

1. 同時準備 Apps Script 的 `Code.gs` 與 GitHub Pages 的 `index.html`、`version.json`；先部署後端，再立即更新前端。舊版前端的 GET 報告入口將失效，需重新整理。
2. 保留既有 Apps Script 部署網址及舊版本，方便回復。Google Sheet 既有資料不需移動、刪除或重建。
3. 管理員親自設定獨立掃描密鑰後，才提供現場同仁使用。不要在公開 issue、PR 或聊天內貼出密鑰。
4. 以唯讀 health/config 回應確認後端版本，並在獨立測試表做 6–8 裝置演練。測試不可混入正式廠商資料。
5. 本次修正只修改 Expo 登錄程式。`Code_CRM.gs` / `Index_CRM.html` 是另一套部署；不可將 Expo 的多人輸入驗證視為 CRM 多人編輯驗證。
