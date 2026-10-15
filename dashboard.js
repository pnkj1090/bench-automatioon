import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { CONFIG, getRuntimeConfig, saveRuntimeConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // Strictly loopback only for zero-exposure security
const TOKEN_FILE = path.join(__dirname, 'token.txt');
const REFRESH_TOKEN_FILE = path.join(__dirname, 'refresh-token.txt');
const LOG_FILE = path.join(process.env.HOME || '/home/ec2-user', '.pm2', 'logs', 'prod-automator-out.log');

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      Buffer.from(base64, 'base64')
        .toString('binary')
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const parsed = JSON.parse(jsonPayload);
    return {
      name: parsed.name || parsed.given_name || 'Nagarro Candidate',
      email: parsed.upn || parsed.unique_name || parsed.email || 'pankaj.kumar07@nagarro.com',
      exp: parsed.exp,
      validMinutes: Math.max(0, Math.round((parsed.exp - Math.floor(Date.now() / 1000)) / 60))
    };
  } catch (e) {
    return null;
  }
}

function getStoredToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    }
  } catch (e) {}
  return null;
}

function hasRefreshToken() {
  try {
    return fs.existsSync(REFRESH_TOKEN_FILE) && fs.readFileSync(REFRESH_TOKEN_FILE, 'utf8').trim().length > 0;
  } catch (e) {
    return false;
  }
}

function getLogLines(filePath, maxLines = 80) {
  try {
    if (!fs.existsSync(filePath)) return ['No logs available yet.'];
    const data = fs.readFileSync(filePath, 'utf8');
    const lines = data.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch (e) {
    return [`Error reading logs: ${e.message}`];
  }
}

function getPm2Status() {
  return new Promise((resolve) => {
    exec('pm2 jlist', (err, stdout) => {
      if (err || !stdout) {
        return resolve({ status: 'unknown', memoryMb: 0, cpu: 0, uptime: 0 });
      }
      try {
        const list = JSON.parse(stdout);
        const proc = list.find(p => p.name === 'prod-automator');
        if (proc) {
          resolve({
            status: proc.pm2_env.status,
            memoryMb: Math.round((proc.monit.memory || 0) / 1024 / 1024),
            cpu: proc.monit.cpu || 0,
            uptime: Math.round((Date.now() - proc.pm2_env.pm_uptime) / 1000)
          });
        } else {
          resolve({ status: 'not found', memoryMb: 0, cpu: 0, uptime: 0 });
        }
      } catch (e) {
        resolve({ status: 'error', memoryMb: 0, cpu: 0, uptime: 0 });
      }
    });
  });
}

function parseStatsFromLogs(lines) {
  let cycles = 0;
  let skippedAlreadyApplied = 0;
  let skippedPythonOnly = 0;
  let applied = 0;
  let lastScan = 'Never';

  for (const line of lines) {
    const cycleMatch = line.match(/Cycle #(\d+):/);
    if (cycleMatch) {
      cycles = Math.max(cycles, parseInt(cycleMatch[1], 10));
    }
    const timeMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);
    if (timeMatch) {
      lastScan = timeMatch[1];
    }
    if (line.includes('Already applied')) skippedAlreadyApplied++;
    if (line.includes('Only Python required')) skippedPythonOnly++;
    if (line.includes('APPLIED to')) applied++;
  }

  return { cycles, skippedAlreadyApplied, skippedPythonOnly, applied, lastScan };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demand Automator • Mission Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(17, 24, 39, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --card-hover: rgba(255, 255, 255, 0.12);
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --text-dim: #6b7280;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      height: 100vh;
      max-height: 100vh;
      overflow: hidden;
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.4;
      font-size: 13px;
      -webkit-font-smoothing: antialiased;
    }

    /* Master Container: Fixed 100vh Single-Page Layout */
    .app-layout {
      height: 100vh;
      max-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 10px 14px;
      gap: 10px;
      box-sizing: border-box;
    }

    /* Top Navigation Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 16px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      backdrop-filter: blur(16px);
      flex-shrink: 0;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      width: 32px; height: 32px;
      background: linear-gradient(135deg, #3b82f6, #1d4ed8);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
    }
    .brand-meta h1 {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-meta p {
      font-size: 11px;
      color: var(--text-muted);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Status Pills */
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
    }
    .status-pill.online {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.25);
      color: var(--success);
    }
    .status-pill.stopped {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: var(--danger);
    }
    .pulse-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
    }
    .status-pill.online .pulse-dot {
      background: var(--success);
      box-shadow: 0 0 8px var(--success);
      animation: pulse 2s infinite;
    }
    .status-pill.stopped .pulse-dot { background: var(--danger); }
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.3); }
      100% { opacity: 1; transform: scale(1); }
    }

    /* Modern Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .btn-pause {
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.25);
      color: #fbbf24;
    }
    .btn-pause:hover { background: rgba(245, 158, 11, 0.22); }
    .btn-resume {
      background: rgba(16, 185, 129, 0.12);
      border-color: rgba(16, 185, 129, 0.25);
      color: #34d399;
    }
    .btn-resume:hover { background: rgba(16, 185, 129, 0.22); }
    .btn-outline {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.12);
      color: #fff;
    }
    .btn-outline:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.2); }
    .btn-primary {
      background: #2563eb;
      color: #fff;
    }
    .btn-primary:hover { background: #1d4ed8; }

    /* Main Split Dashboard (Left: Controls & Metrics | Right: Live Terminal) */
    .dashboard-body {
      flex: 1;
      min-height: 0; /* Crucial for zero-scroll flex child */
      display: grid;
      grid-template-columns: 380px 1fr;
      gap: 10px;
    }

    /* Left Control Column */
    .control-column {
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
      min-height: 0;
    }
    .control-column::-webkit-scrollbar { width: 4px; }
    .control-column::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }

    /* Modern Glass Card */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 10px 14px;
      backdrop-filter: blur(16px);
      transition: border-color 0.2s;
    }
    .card:hover {
      border-color: var(--card-hover);
    }
    .card-title {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Standby Switch Card */
    .standby-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .standby-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .standby-state {
      font-size: 13px;
      font-weight: 700;
      color: #fff;
    }
    .standby-desc {
      font-size: 11px;
      color: var(--text-dim);
    }
    .btn-override {
      font-size: 11.5px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 7px;
      cursor: pointer;
      border: 1px solid transparent;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .btn-override.force-run {
      background: linear-gradient(135deg, #d97706, #b45309);
      color: #fff;
      box-shadow: 0 2px 8px rgba(217, 119, 6, 0.35);
    }
    .btn-override.force-run:hover { background: #b45309; }
    .btn-override.restore-standby {
      background: rgba(139, 92, 246, 0.15);
      border-color: rgba(139, 92, 246, 0.3);
      color: #c084fc;
    }
    .btn-override.restore-standby:hover { background: rgba(139, 92, 246, 0.25); }

    /* Interval Form */
    .interval-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .interval-inputs {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .interval-field {
      width: 50px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      color: #fff;
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 700;
      text-align: center;
      padding: 4px 6px;
    }
    .interval-field:focus { outline: none; border-color: var(--primary); }
    .btn-save-sm {
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #60a5fa;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-save-sm:hover { background: #2563eb; color: #fff; }

    /* Token & Profile Card */
    .profile-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .profile-name {
      font-size: 13px;
      font-weight: 700;
      color: #fff;
    }
    .profile-email {
      font-size: 11px;
      color: var(--text-muted);
    }
    .token-pill {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 5px;
    }
    .token-pill.valid { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .token-pill.warning { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .token-pill.expired { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }

    .meta-line {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--text-dim);
      padding-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }

    /* Metrics 2x2 Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .metric-box {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 9px;
      padding: 9px 12px;
      display: flex;
      flex-direction: column;
    }
    .metric-box .label {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--text-dim);
      letter-spacing: 0.03em;
    }
    .metric-box .value {
      font-family: var(--font-mono);
      font-size: 20px;
      font-weight: 700;
      color: #fff;
      margin: 2px 0;
    }
    .metric-box .sub {
      font-size: 10px;
      color: var(--text-muted);
    }

    /* Right Column: Full-Height Live Terminal */
    .terminal-column {
      display: flex;
      flex-direction: column;
      background: #060911;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
      min-height: 0;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }
    .terminal-header {
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      padding: 8px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .terminal-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .mac-dot {
      width: 9px; height: 9px;
      border-radius: 50%;
    }
    .dot-close { background: #ef4444; }
    .dot-min { background: #f59e0b; }
    .dot-max { background: #10b981; }

    .terminal-title {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      margin-left: 6px;
    }
    .terminal-meta {
      font-family: var(--font-mono);
      font-size: 10.5px;
      color: #60a5fa;
    }

    .terminal-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 10px 14px;
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.5;
      background: #04070e;
    }
    .terminal-body::-webkit-scrollbar { width: 5px; }
    .terminal-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 3px; }
    .terminal-body::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }

    .log-line {
      white-space: pre-wrap;
      word-break: break-all;
      margin-bottom: 3px;
    }
    .log-line.standby { color: #fde047; font-weight: 500; }
    .log-line.info { color: #93c5fd; }
    .log-line.skip { color: #fbbf24; }
    .log-line.success { color: #86efac; font-weight: 600; }
    .log-line.error { color: #fca5a5; font-weight: 600; }

    .terminal-footer {
      background: rgba(255, 255, 255, 0.02);
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding: 4px 14px;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      flex-shrink: 0;
    }

    /* Modal Overlay */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      padding: 20px; z-index: 1000; opacity: 0; pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .modal-overlay.open { opacity: 1; pointer-events: auto; }
    .modal-box {
      background: #111827; border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 14px; width: 100%; max-width: 520px; padding: 20px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
      transform: scale(0.96); transition: transform 0.2s ease;
    }
    .modal-overlay.open .modal-box { transform: scale(1); }
    .modal-title { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 6px; }
    .modal-desc { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4; }
    .token-textarea {
      width: 100%; height: 90px;
      background: #030712; border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px; color: #fff; font-family: var(--font-mono);
      font-size: 11px; padding: 10px; resize: none; margin-bottom: 14px;
    }
    .token-textarea:focus { outline: none; border-color: var(--primary); }
    .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }

    /* Toast */
    .toast {
      position: fixed; bottom: 20px; right: 20px;
      background: #1e293b; border: 1px solid rgba(255, 255, 255, 0.15);
      color: #fff; padding: 8px 16px; border-radius: 8px;
      font-size: 12px; font-weight: 600;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      opacity: 0; transform: translateY(10px);
      transition: all 0.25s ease;
      z-index: 2000; pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
  </style>
</head>
<body>

  <div class="app-layout">
    
    <!-- Top Navigation Header -->
    <header>
      <div class="brand">
        <div class="brand-logo">⚡</div>
        <div class="brand-meta">
          <h1>Demand Automator <span id="statusBadge" class="status-pill stopped"><span class="pulse-dot"></span><span id="statusText">CHECKING...</span></span></h1>
          <p>Nagarro Opportunistic Placement • 24/7 Cloud Engine</p>
        </div>
      </div>

      <div class="header-actions">
        <button id="btnPauseResume" class="btn btn-pause" onclick="togglePauseResume()">
          <span id="iconPR">⏸️</span> <span id="textPR">Pause</span>
        </button>
        <button class="btn btn-outline" onclick="restartEngine()" title="Restart engine process">
          🔄 Restart
        </button>
        <button class="btn btn-primary" onclick="openTokenModal()">
          🔑 Token & Auto-Renew
        </button>
      </div>
    </header>

    <!-- Main Split Dashboard Layout -->
    <div class="dashboard-body">
      
      <!-- Left Column: Controls & Metrics -->
      <div class="control-column">
        
        <!-- Operating Schedule & Standby Override Card -->
        <div class="card">
          <div class="card-title">
            <span>Operating Schedule & Standby</span>
            <span id="badgeStandby" class="status-pill stopped" style="padding: 2px 6px; font-size: 10px;">Standby</span>
          </div>
          <div class="standby-row">
            <div class="standby-info">
              <span id="standbyHeading" class="standby-state">🌙 Standby Sleep Mode</span>
              <span class="standby-desc">Standard: Mon–Fri, 8:00 AM – 8:00 PM IST</span>
            </div>
            <button id="btnToggleStandby" class="btn-override force-run" onclick="toggleStandbyOverride()">
              ⚡ Run Now
            </button>
          </div>
        </div>

        <!-- Scan Frequency Card -->
        <div class="card">
          <div class="card-title">
            <span>Cycle Polling Frequency</span>
            <span style="font-size: 10px; color: var(--text-dim);">AWS Background Runner</span>
          </div>
          <div class="interval-row">
            <span style="color: var(--text-muted); font-size: 12px;">Query portal every:</span>
            <div class="interval-inputs">
              <input type="number" id="inputInterval" class="interval-field" min="5" max="3600" value="30">
              <span style="color: var(--text-muted); font-size: 11px;">seconds</span>
              <button class="btn-save-sm" onclick="saveInterval()">Save</button>
            </div>
          </div>
        </div>

        <!-- Candidate Profile & Authentication Health -->
        <div class="card">
          <div class="card-title">
            <span>Candidate & Authentication</span>
            <span id="stripTokenPill" class="token-pill valid">Valid: --:--</span>
          </div>
          <div class="profile-line">
            <div>
              <div id="stripCandidate" class="profile-name">Pankaj Kumar</div>
              <div class="profile-email">pankaj.kumar07@nagarro.com</div>
            </div>
            <div id="stripAutoRenew" style="font-size: 11px; font-weight: 600; color: #34d399;">
              ✅ 45m Auto-Renew Active
            </div>
          </div>
          <div class="meta-line">
            <span>Server Resources:</span>
            <span id="stripServer" style="font-family: var(--font-mono); color: #fff;">RAM: -- MB | CPU: --% | Up: --</span>
          </div>
        </div>

        <!-- Real-Time Metrics Deck (2x2 Grid) -->
        <div class="metrics-grid">
          <div class="metric-box">
            <span class="label">Scan Cycles</span>
            <span id="valCycles" class="value">#0</span>
            <span id="valLastScan" class="sub">Last: Never</span>
          </div>

          <div class="metric-box">
            <span class="label">Demands Evaluated</span>
            <span id="valEvaluated" class="value">0</span>
            <span class="sub">Gurugram & WFA</span>
          </div>

          <div class="metric-box">
            <span class="label">Disqualified / Skipped</span>
            <span id="valSkipped" class="value">0</span>
            <span class="sub">Python-only or Applied</span>
          </div>

          <div class="metric-box">
            <span class="label">Auto-Applied</span>
            <span id="valApplied" class="value" style="color: #34d399;">0</span>
            <span class="sub">Frontend & Full-stack</span>
          </div>
        </div>

      </div>

      <!-- Right Column: Full-Height Live Telemetry Terminal -->
      <div class="terminal-column">
        <div class="terminal-header">
          <div class="terminal-controls">
            <div class="mac-dot dot-close"></div>
            <div class="mac-dot dot-min"></div>
            <div class="mac-dot dot-max"></div>
            <span class="terminal-title">LIVE TELEMETRY STREAM</span>
          </div>
          <div id="terminalMeta" class="terminal-meta">
            EC2 ap-south-1 • PM2 PID: --
          </div>
        </div>

        <div id="terminalLogs" class="terminal-body">
          <div class="log-line info">Connecting to AWS cloud logs...</div>
        </div>

        <div class="terminal-footer">
          <span>Target: https://opportunistic-placement.azurewebsites.net</span>
          <span>Security: Loopback 127.0.0.1:3000 • Encrypted SSH Tunnel</span>
        </div>
      </div>

    </div>

  </div>

  <!-- Token Modal Dialog -->
  <div id="tokenModal" class="modal-overlay" onclick="if(event.target===this) closeTokenModal()">
    <div class="modal-box">
      <h2 class="modal-title">🔑 Update Azure AD / Refresh Token</h2>
      <p class="modal-desc">Paste your fresh Microsoft Entra ID Refresh Token (recommended for 24/7 autonomous renewal) or Bearer Access Token.</p>
      <textarea id="tokenInput" class="token-textarea" placeholder="Paste token here (starts with '0.A...' or 'eyJ...')..."></textarea>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeTokenModal()">Cancel</button>
        <button id="btnSaveToken" class="btn btn-primary" onclick="submitToken()">Save & Enable Auto-Renew</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div id="toast" class="toast">Action notification</div>

  <script>
    let currentStatus = 'unknown';
    let tokenExpTimestamp = 0;
    let countdownInterval = null;
    let isOverrideActive = false;
    let currentInterval = 30;

    function showToast(msg, isError = false) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.borderColor = isError ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)';
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 3000);
    }

    function formatUptime(seconds) {
      if (!seconds) return '0s';
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (d > 0) return d + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    function updateCountdown() {
      const el = document.getElementById('stripTokenPill');
      if (!tokenExpTimestamp) {
        el.innerText = 'No Token';
        el.className = 'token-pill expired';
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const diff = tokenExpTimestamp - now;
      if (diff <= 0) {
        el.innerText = 'Expired (Auto-renewing...)';
        el.className = 'token-pill expired';
      } else {
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        el.innerText = 'Valid: ' + m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        if (diff > 900) el.className = 'token-pill valid';
        else if (diff > 300) el.className = 'token-pill warning';
        else el.className = 'token-pill expired';
      }
    }

    async function fetchData() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        // PM2 Status
        if (data.pm2) {
          currentStatus = data.pm2.status;
          const badge = document.getElementById('statusBadge');
          const text = document.getElementById('statusText');
          const btnPR = document.getElementById('btnPauseResume');
          const iconPR = document.getElementById('iconPR');
          const textPR = document.getElementById('textPR');

          if (currentStatus === 'online') {
            badge.className = 'status-pill online';
            text.innerText = 'ONLINE';
            btnPR.className = 'btn btn-pause';
            iconPR.innerText = '⏸️';
            textPR.innerText = 'Pause';
          } else {
            badge.className = 'status-pill stopped';
            text.innerText = 'PAUSED';
            btnPR.className = 'btn btn-resume';
            iconPR.innerText = '▶️';
            textPR.innerText = 'Resume';
          }

          document.getElementById('stripServer').innerText = 'RAM: ' + data.pm2.memoryMb + ' MB | CPU: ' + data.pm2.cpu + '% | Up: ' + formatUptime(data.pm2.uptime);
          document.getElementById('terminalMeta').innerText = 'PM2: ' + currentStatus.toUpperCase() + ' (RAM: ' + data.pm2.memoryMb + 'MB) • Interval: ' + (data.runtimeConfig?.pollIntervalSeconds || 30) + 's';
        }

        // Runtime Config: Interval & Standby Override
        if (data.runtimeConfig) {
          isOverrideActive = Boolean(data.runtimeConfig.standbyOverride);
          currentInterval = data.runtimeConfig.pollIntervalSeconds || 30;

          const inputInt = document.getElementById('inputInterval');
          if (document.activeElement !== inputInt) {
            inputInt.value = currentInterval;
          }

          updateStandbyUI();
        }

        // Token Info
        if (data.token) {
          tokenExpTimestamp = data.token.exp;
          document.getElementById('stripCandidate').innerText = data.token.name;
          updateCountdown();
        }

        // Auto Renew
        if (data.hasRefreshToken) {
          document.getElementById('stripAutoRenew').innerHTML = '<span style="color: #34d399;">✅ 45m Auto-Renew Active</span>';
        } else {
          document.getElementById('stripAutoRenew').innerHTML = '<span style="color: #f59e0b;">⚠️ Manual Token Only</span>';
        }

        // Stats
        if (data.stats) {
          document.getElementById('valCycles').innerText = '#' + data.stats.cycles;
          document.getElementById('valEvaluated').innerText = (data.stats.cycles * 2);
          document.getElementById('valSkipped').innerText = (data.stats.skippedAlreadyApplied + data.stats.skippedPythonOnly);
          document.getElementById('valApplied').innerText = data.stats.applied;
          document.getElementById('valLastScan').innerText = 'Last: ' + data.stats.lastScan;
        }

        // Logs
        const term = document.getElementById('terminalLogs');
        if (data.logs && data.logs.length) {
          term.innerHTML = data.logs.map(line => {
            let cls = 'info';
            if (line.includes('[STANDBY]')) cls = 'standby';
            else if (line.includes('[SKIP]')) cls = 'skip';
            else if (line.includes('APPLIED to')) cls = 'success';
            else if (line.includes('[SUCCESS]') || line.includes('auto-renewed')) cls = 'success';
            else if (line.includes('[ERROR]') || line.includes('Error')) cls = 'error';
            return '<div class="log-line ' + cls + '">' + escapeHtml(line) + '</div>';
          }).join('');
          term.scrollTop = term.scrollHeight;
        }

      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    function updateStandbyUI() {
      const badge = document.getElementById('badgeStandby');
      const btn = document.getElementById('btnToggleStandby');
      const heading = document.getElementById('standbyHeading');

      const istStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      const istDate = new Date(istStr);
      const day = istDate.getDay();
      const hour = istDate.getHours();
      const isNormalWorkingHours = (day >= 1 && day <= 5 && hour >= 8 && hour < 20);

      if (isOverrideActive) {
        badge.className = 'status-pill stopped';
        badge.style.background = 'rgba(139, 92, 246, 0.15)';
        badge.style.borderColor = 'rgba(139, 92, 246, 0.3)';
        badge.style.color = '#c084fc';
        badge.innerText = '⚡ Override Active';
        heading.innerText = '⚡ Manual Override Active';
        btn.className = 'btn-override restore-standby';
        btn.innerText = '🌙 Re-enable Standby';
        btn.title = 'Return to scheduled standby (Mon-Fri 8AM-8PM IST)';
      } else if (!isNormalWorkingHours) {
        badge.className = 'status-pill stopped';
        badge.style.background = 'rgba(245, 158, 11, 0.15)';
        badge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
        badge.style.color = '#fbbf24';
        badge.innerText = (day === 0 || day === 6) ? '🏖️ Weekend Standby' : '🌙 Night Standby';
        heading.innerText = (day === 0 || day === 6) ? '🏖️ Weekend Standby' : '🌙 Night Standby Mode';
        btn.className = 'btn-override force-run';
        btn.innerText = '⚡ Run Now';
        btn.title = 'Bypass schedule and run automation immediately right now';
      } else {
        badge.className = 'status-pill online';
        badge.style.background = 'rgba(16, 185, 129, 0.15)';
        badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        badge.style.color = '#34d399';
        badge.innerText = '🟢 Active Window';
        heading.innerText = '🟢 Active Operating Hours';
        btn.className = 'btn-override restore-standby';
        btn.innerText = '🌙 Force Sleep';
        btn.title = 'Put engine into standby sleep mode';
      }
    }

    async function toggleStandbyOverride() {
      const newOverride = !isOverrideActive;
      try {
        const res = await fetch('/api/config/standby-override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ standbyOverride: newOverride })
        });
        const data = await res.json();
        if (data.success) {
          showToast(newOverride ? '⚡ Standby overridden! Engine running actively now.' : '🌙 Returned to scheduled standby rules.');
          fetchData();
        } else {
          showToast('Failed to toggle standby: ' + (data.error || 'Unknown error'), true);
        }
      } catch (e) {
        showToast('Error: ' + e.message, true);
      }
    }

    async function saveInterval() {
      const input = document.getElementById('inputInterval');
      const sec = parseInt(input.value, 10);
      if (isNaN(sec) || sec < 5 || sec > 3600) {
        alert('Please enter a valid interval between 5 and 3600 seconds.');
        input.value = currentInterval;
        return;
      }

      try {
        const res = await fetch('/api/config/interval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intervalSeconds: sec })
        });
        const data = await res.json();
        if (data.success) {
          showToast('⏱️ Poll interval set to ' + sec + 's! Engine restarted.');
          fetchData();
        } else {
          showToast('Failed: ' + (data.error || 'Could not update interval'), true);
        }
      } catch (e) {
        showToast('Error: ' + e.message, true);
      }
    }

    async function togglePauseResume() {
      const action = currentStatus === 'online' ? 'pause' : 'resume';
      try {
        const res = await fetch('/api/engine/' + action, { method: 'POST' });
        const data = await res.json();
        showToast(action === 'pause' ? '⏸️ Automation paused.' : '▶️ Automation resumed!');
        fetchData();
      } catch (e) {
        showToast('Action failed: ' + e.message, true);
      }
    }

    async function restartEngine() {
      try {
        await fetch('/api/engine/restart', { method: 'POST' });
        showToast('🔄 Automation engine restarted!');
        fetchData();
      } catch (e) {
        showToast('Restart failed: ' + e.message, true);
      }
    }

    function openTokenModal() {
      document.getElementById('tokenModal').classList.add('open');
      document.getElementById('tokenInput').focus();
    }

    function closeTokenModal() {
      document.getElementById('tokenModal').classList.remove('open');
      document.getElementById('tokenInput').value = '';
    }

    async function submitToken() {
      const token = document.getElementById('tokenInput').value.trim();
      if (!token) {
        alert('Please paste a token.');
        return;
      }
      const btn = document.getElementById('btnSaveToken');
      btn.disabled = true;
      btn.innerText = 'Activating on AWS...';

      try {
        const res = await fetch('/api/token/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || '🎉 Autonomous auto-renewal activated on AWS!');
          closeTokenModal();
          fetchData();
        } else {
          showToast('Failed: ' + (data.error || 'Invalid token'), true);
        }
      } catch (e) {
        showToast('Error: ' + e.message, true);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Save & Enable Auto-Renew';
      }
    }

    function escapeHtml(text) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    fetchData();
    setInterval(fetchData, 2500);
    countdownInterval = setInterval(updateCountdown, 1000);
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // GET /api/status
  if (pathname === '/api/status' && method === 'GET') {
    const pm2 = await getPm2Status();
    const storedToken = getStoredToken();
    const token = parseJwt(storedToken);
    const hasRefresh = hasRefreshToken();
    const logs = getLogLines(LOG_FILE, 70);
    const stats = parseStatsFromLogs(logs);
    const runtimeConfig = getRuntimeConfig();

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({ pm2, token, hasRefreshToken: hasRefresh, stats, logs, runtimeConfig }));
  }

  // POST /api/config/interval
  if (pathname === '/api/config/interval' && method === 'POST') {
    const body = await parseJsonBody(req);
    const sec = parseInt(body.intervalSeconds, 10);
    if (isNaN(sec) || sec < 5 || sec > 3600) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Interval must be between 5 and 3600 seconds' }));
    }
    saveRuntimeConfig({ pollIntervalSeconds: sec });
    exec('pm2 restart prod-automator', (err) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: !err, pollIntervalSeconds: sec }));
    });
    return;
  }

  // POST /api/config/standby-override
  if (pathname === '/api/config/standby-override' && method === 'POST') {
    const body = await parseJsonBody(req);
    const override = Boolean(body.standbyOverride);
    saveRuntimeConfig({ standbyOverride: override });
    exec('pm2 restart prod-automator', (err) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: !err, standbyOverride: override }));
    });
    return;
  }

  // POST /api/token/update
  if (pathname === '/api/token/update' && method === 'POST') {
    const body = await parseJsonBody(req);
    const rawToken = (body.token || '').trim();
    if (!rawToken) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Token is required' }));
    }

    if (rawToken.startsWith('0.A') || (rawToken.length > 500 && !rawToken.includes('.'))) {
      fs.writeFileSync(REFRESH_TOKEN_FILE, rawToken, { mode: 0o600 });
      exec('pm2 restart prod-automator', (err) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({
          success: !err,
          isRefreshToken: true,
          message: 'Refresh Token saved! 24/7 autonomous token auto-renew is active.'
        }));
      });
      return;
    }

    fs.writeFileSync(TOKEN_FILE, rawToken, { mode: 0o600 });
    const parsed = parseJwt(rawToken);
    exec('pm2 restart prod-automator', (err) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({
        success: !err,
        isRefreshToken: false,
        message: 'Access Token updated. Paste your Refresh Token for 24/7 auto-renew!',
        token: parsed
      }));
    });
    return;
  }

  // POST /api/engine/pause
  if (pathname === '/api/engine/pause' && method === 'POST') {
    exec('pm2 stop prod-automator', (err) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: !err, status: 'stopped' }));
    });
    return;
  }

  // POST /api/engine/resume
  if (pathname === '/api/engine/resume' && method === 'POST') {
    exec('pm2 start prod-automator', (err) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: !err, status: 'online' }));
    });
    return;
  }

  // POST /api/engine/restart
  if (pathname === '/api/engine/restart' && method === 'POST') {
    exec('pm2 restart prod-automator', (err) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: !err, status: 'restarted' }));
    });
    return;
  }

  // Serve Dashboard HTML
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML_CONTENT);
});

server.listen(PORT, HOST, () => {
  console.log(`🔒 Private Dashboard running strictly on http://${HOST}:${PORT}`);
  console.log(`   (Public access blocked; use open-dashboard.sh for SSH tunnel)`);
});
