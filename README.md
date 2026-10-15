# Opportunistic Placement Demand Automation Suite

An automated monitoring, filtering, and candidate application suite for the Opportunistic Placement portal (`https://opportunistic-placement.azurewebsites.net/demands`).

Includes a **high-fidelity mock portal clone**, a **real-time automation dashboard**, and an **autonomous background worker**.

---

## 1. Feasibility Analysis

### Can this run on a hosted website/cloud when your computer is off?
**YES.** The automation worker (`worker.js` or `engine.js`) is completely decoupled from any graphical browser. It communicates directly with the portal's backend REST APIs (`/api/demand/fetchDemands`, `/api/demand/file`, `/api/demand/:id/interest`).
- You can host it 24/7 on services like **Render**, **Railway**, **Fly.io**, or an inexpensive VPS for free or pennies per month.
- **Authentication Note**: Because `opportunistic-placement.azurewebsites.net` is secured with corporate Azure AD (MSAL), cloud execution requires either:
  1. An Azure AD bearer token / session cookie exported from your browser, OR
  2. A script that refreshes your session using corporate credentials.

### Can it run on your Mac even when the screen is locked?
**YES.** On macOS, background command-line processes (like Node.js or Python) continue running without interruption when your screen is locked. To prevent your Mac from going into deep system sleep while locked, run it with macOS's built-in `caffeinate`:
```bash
caffeinate -s npm run worker:mock
```
or against production:
```bash
caffeinate -s node worker.js --target=prod --token="YOUR_AZURE_BEARER_TOKEN"
```

---

## 2. Active Filter Settings (From Screenshots)

### Genus Roles (16 Profiles Selected)
- `2.1-PYTHON`, `2.2-PYTHON`, `2.3-PYTHON`, `3.1-PYTHON`, `3.2-PYTHON`
- `3.1-FRONTEND-ANGULAR2X`, `3.1-FRONTEND-ANGULARJS`, `3.1-FRONTEND-REACT`
- `3.2-FRONTEND-ANGULAR2X`, `3.2-FRONTEND-ANGULARJS`, `3.2-FRONTEND-REACT`
- `3.3-FRONTEND-ANGULAR2X`, `3.3-FRONTEND-REACT`
- `4.1-FRONTEND-ANGULAR2X`, `4.1-FRONTEND-REACT`
- `4.2-FRONTEND-ANGULAR2X`, `4.2-FRONTEND-REACT`

### Location
- `India - Gurugram, Haryana, India - WFA`

---

## 3. Decision & Qualification Rules

| Scenario | Qualification | Action |
| :--- | :---: | :--- |
| **Only Python** (e.g. `2.2-PYTHON` with Python/FastAPI) | 🚫 Disqualified | **SKIP** (Never applies) |
| **Frontend Alone** (React, Angular, Vue, etc.) | ✅ Qualified | **APPLY** automatically |
| **Frontend + Python Combined** | ✅ Qualified | **APPLY** automatically |
| **Already Applied** (`interested: true` or previously submitted) | ⏭️ Skipped | **SKIP** |

---

## 4. Testing the Mock Portal Clone

A full mock clone of the portal is already running at **`http://localhost:3000`**.

### Features of the Mock Portal:
1. **Accurate UI Clone**: Matches the real Opportunistic Placement layout, filters, cards, and application modal.
2. **Live Automation Dock**:
   - Live 10-second countdown timer.
   - Status indicators (RUNNING / PAUSED).
   - Real-time statistics (Cycles, Evaluated, Applied, Skipped).
3. **One-Click Test Scenarios**:
   - `+ Inject Frontend Job` -> See the automation detect and apply to it live.
   - `+ Inject Python Only Job` -> See the automation detect and skip it with explanation.
   - `+ Inject Frontend+Python Job` -> See the automation detect and apply to it.
   - `↺ Reset Mock DB` -> Resets the portal data.
   - `📋 View Live Logs` -> Opens real-time terminal telemetry.

---

## 5. Next Phase: Profile & Application Customization

When you're ready, we will wire up your specific details in `config.js`:
1. **Resume File**: Place your resume in the project or specify the path.
2. **Must-Have Skills**: Specify which skills to check off when applying.
3. **"What Sets Me Apart"**: Your custom 2000-character candidate pitch.
