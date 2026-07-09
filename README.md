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
5. 執行一次 `crearTriggerDiario()`，安裝每晚 19:30 自動報告觸發器。
6. 「部署 → 新增部署作業 → 網頁應用程式」：
   - 執行身分：**我**
   - 具有存取權的使用者：**所有人**（前端匿名 POST 必須如此）
7. 複製產生的 Web App URL（結尾是 `/exec`）。

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
| 網頁連結 | `<WebAppURL>?action=reporte`（可加 `&fecha=2026-07-08` 看特定日） |

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
- **時區** → 全部以 `America/Asuncion` 計算，`CONFIG.ZONA_HORARIA` 可改。

---

# PTITP CRM 展後追蹤系統（Fase 1–3 + W1 網頁介面）

**架構與上述展會問卷系統獨立**。CRM 使用另一份 Google Sheet + Apps Script（`Code_CRM.gs`），從展會 Sheet 定時同步 leads，並在 Sheet 內做 Pipeline / 參訪 / 地籍管理。W1 加入了手機可用的網頁介面（`Index_CRM.html`）。

## CRM 網頁介面（W1）部署 SOP

給客戶／使用者（手機開網頁看 Dashboard + Kanban）的部署步驟。

**先決條件**：CRM 是**獨立的 Google Sheet**（不是展會問卷那份），`Code_CRM.gs` 早前應該已經先跑過 `setupCRM()` 建好分頁。這份 SOP 只加「網頁介面」。

### 一、把程式碼放進 CRM Sheet 的 Apps Script

1. 打開你的 **CRM Sheet**（**不是** script.google.com，一定要從 Sheet 開，否則 web 讀不到資料）。
2. 選單「擴充功能 → Apps Script」。
3. 檢查左側 `Code_CRM.gs` 的最後幾百行，是否已經有 `function doGet(e)` 和 `function webDatos()`。
   - **有** → 跳到步驟 5。
   - **沒有** → 從 GitHub repo 拉最新的 `Code_CRM.gs`，整個檔案覆蓋貼上，存檔。
4. 左側檔案列表 →「+」→ HTML → 檔名輸入 **`Index`**（⚠️ 不能是 `Index_CRM`，`doGet` 只讀名為 `Index` 的檔），把 `Index_CRM.html` 內容整份貼入，存檔。
5. 選單「執行 → 選函式 `setupCRM` → 執行」（如果之前跑過，再跑一次也 OK，只會補上「Usuarios web」這一列 Config）。
6. 回到 CRM Sheet →「Config」分頁 → 找到「Usuarios web」那列：
   - 想只允許自己看 → **B 欄留空**（交由部署層擋）。
   - 想開放同事看 → **B 欄填入 email 白名單**，用逗號分隔，例如：`jaime@ptitp.com.py, maria@ptitp.com.py`。

### 二、部署為網頁應用程式

1. Apps Script 編輯器右上「部署 → 新增部署作業」。
2. 齒輪圖示 → 選「網頁應用程式」。
3. 說明填 `PTITP CRM v1`。
4. 執行身分：**我**（關鍵——這樣程式能以你的權限讀寫 Sheet）。
5. 具有存取權的使用者：
   - 只有自己看 → 選「**只有我自己**」。
   - 開放同事看 → 選「任何擁有 Google 帳戶的使用者」（白名單由 Config 那欄擋）。
6. 「部署」→ Google 會要求授權 → 授權。
7. 複製產生的**網頁應用程式 URL**（結尾是 `/exec`）。
8. 手機打開這個 URL → 加到主畫面。

### 三、驗收（**這步很重要，不能跳**）

打開手機上的 `/exec` 網址後，對照以下三點：

| 檢查 | 通過 | 不通過表示什麼 |
|---|---|---|
| 頁首**不能**出現紅底斜線 ⚠️ MODO DEMO 警告條 | ✅ | 若出現 → 你**不是**從 `/exec` 進來（可能開到本機檔或錯的 URL），回頭抓 `/exec`。 |
| 頁首左上顯示**你的 Gmail**（不是 `demo@ptitp.com.py`） | ✅ | 若顯示 `demo@ptitp.com.py` → 一樣是走到 DEMO 模式，同上。 |
| KPI「Leads abiertos」= Pipeline 分頁 Etapa NOT IN (Ganado, Perdido) 的列數 | ✅ | 若不一致：①Pipeline 有測試假資料（手動清）②`/exec` 是舊版部署（見四） |

### 四、以後修改程式碼要怎麼上線

**改完程式碼會自動生效嗎？→ 不會。** `/exec` 網址永遠指向「上次部署當下的版本」。要更新：

1. Apps Script 編輯器 →「部署 → 管理部署作業」。
2. 找到你剛才那個部署 → 右邊鉛筆圖示。
3. 版本下拉 → 選「**新版本**」→ 填一個簡短描述（例如 `fix KPI`）→ 部署。
4. `/exec` 網址**不會變**，但手機下拉重新整理就會抓到新版。

### 五、常見翻車情況

| 症狀 | 原因 | 修法 |
|---|---|---|
| 開 `/exec` 看到「Acceso no autorizado」 | 你的 Gmail 不在 Config「Usuarios web」白名單 | 到 Sheet Config 補上你的 email，或直接清空白名單 |
| 開 `/exec` 看到紅底 MODO DEMO 條 | 你不是從 `/exec` 進來，而是從本機檔 `file://` 或別處 | 重新到 Apps Script「管理部署作業」複製正確的 `/exec` |
| 數字全 0 ／ 頁面空白 | Apps Script 是**獨立專案**（script.google.com 新建），沒綁到 CRM Sheet | 打開 CRM Sheet → 擴充功能 → Apps Script，重新做「一、二」 |
| 手機看得到但按 Actualizar 或拖卡片沒反應 | 沒授權寫入權限，或部署身分不是「我」 | 重新走「二、4」設定 |
| 拖卡片後看板恢復原狀 | 後端寫入失敗（通常是 `webEtapa` 拋錯） | Apps Script → 執行紀錄 (Ejecuciones) 看錯誤訊息 |

### 六、給開發者的除錯速查

若客戶說「數字不對」，先要他回報：
1. 頁首 email 是不是 `demo@ptitp.com.py`？→ 是 → **他根本沒開到 `/exec`**，直接送這份 SOP 給他。
2. 頁首有沒有 MODO DEMO 紅條？→ 有 → 同上。
3. 都沒有 → 請他截圖 Pipeline 分頁 + 手機 KPI 畫面，再比對。

若客戶說「改了程式碼沒生效」→ 8 成沒做「管理部署作業 → 新版本」，跟他確認。
