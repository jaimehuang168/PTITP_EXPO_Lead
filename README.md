# PTITP 展會招商問卷系統（Sistema de Captación de Leads）

Google Sheet 當資料庫 + Apps Script 當 API + GitHub Pages 當前端。
推廣人員用手機開連結填問卷 → 自動寫入 Sheet → 每晚 19:30 自動產生西文當日業務報告。

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
6. 如啟用名片辨識，在同一處新增 `ANTHROPIC_API_KEY`。
7. 執行一次 `crearTriggerDiario()`，安裝每晚 19:30 自動報告觸發器。
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
| 自動 Email | 設定 `REPORT_EMAIL` 後每晚 19:30 自動寄出 |
| Sheet 選單 | 打開 Sheet →「📋 PTITP Expo → Generar reporte de hoy」 |
| 網頁查看 | 在前端「Reportes」區輸入主管密鑰後開啟；不要手動分享含 `token` 的報告網址 |

## 前端功能重點

- **一次設定**：展會名 + 推廣員姓名存在裝置 localStorage，每天只填一次。
- **離線佇列**：展場網路斷線時問卷先存手機，恢復連線自動重送（頂部有連線狀態指示）。
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
