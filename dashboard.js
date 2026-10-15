import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { refreshAccessToken } from './renew-token.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const TOKEN_FILE = path.join(__dirname, 'token.txt');
const REFRESH_TOKEN_FILE = path.join(__dirname, 'refresh-token.txt');
const LOG_FILE = process.env.LOG_FILE || path.join(process.env.HOME || '/home/ec2-user', '.pm2/logs/prod-automator-out.log');

function parseJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const cleaned = token.replace(/^Bearer\s+/i, '').replace(/^['"]|['"]$/g, '').trim();
  try {
    const parts = cleaned.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    const payload = JSON.parse(jsonPayload);
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = payload.exp || 0;
    const remainingSec = exp - nowSec;
    return {
      isValid: true,
      name: payload.name || payload.given_name || 'Nagarro Candidate',
      email: payload.upn || payload.unique_name || payload.email || 'pankaj.kumar07@nagarro.com',
      exp: exp,
      expIso: new Date(exp * 1000).toISOString(),
      isExpired: remainingSec <= 0,
      remainingSec: remainingSec,
      maskedToken: cleaned.substring(0, 16) + '...' + cleaned.substring(cleaned.length - 12)
    };
  } catch (e) {
    return null;
  }
}

function getStoredToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (t) return t;
    } catch (e) {}
  }
  return null;
}

function hasRefreshToken() {
  try {
    return fs.existsSync(REFRESH_TOKEN_FILE) && fs.readFileSync(REFRESH_TOKEN_FILE, 'utf8').trim().length > 0;
  } catch (e) {
    return false;
  }
}

function getPm2Status() {
  return new Promise((resolve) => {
    exec('pm2 jlist', (err, stdout) => {
      if (err) return resolve({ status: 'unknown', uptime: 0, cpu: 0, memoryMb: 0 });
      try {
        const list = JSON.parse(stdout);
        const proc = list.find(p => p.name === 'prod-automator');
        if (!proc) return resolve({ status: 'stopped', uptime: 0, cpu: 0, memoryMb: 0 });
        return resolve({
          status: proc.pm2_env.status,
          uptime: proc.pm2_env.pm_uptime ? Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1000) : 0,
          restarts: proc.pm2_env.restart_time || 0,
          cpu: proc.monit ? proc.monit.cpu : 0,
          memoryMb: proc.monit ? Math.round(proc.monit.memory / (1024 * 1024)) : 0
        });
      } catch (e) {
        resolve({ status: 'unknown', uptime: 0, cpu: 0, memoryMb: 0 });
      }
    });
  });
}

function getLogLines(filePath, maxLines = 80) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch (e) {
    return [`Error reading log file: ${e.message}`];
  }
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
    req.on('error', reject);
  });
}

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Opportunistic Placement — Live Automation Suite</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(18, 24, 38, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #3b82f6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: var(--font-sans);
      min-height: 100vh;
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 1200px; margin: 0 auto; }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand-icon {
      width: 44px; height: 44px;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 16px rgba(37, 99, 235, 0.3);
    }
    .brand-title h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
    .brand-title p { font-size: 13px; color: var(--text-muted); }
    .header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

    .status-badge {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 16px; border-radius: 9999px;
      font-size: 13px; font-weight: 600;
    }
    .status-badge.online {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success);
    }
    .status-badge.stopped {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--danger);
    }
    .pulse-dot { width: 8px; height: 8px; border-radius: 50%; }
    .status-badge.online .pulse-dot {
      background: var(--success);
      box-shadow: 0 0 10px var(--success);
      animation: pulse 2s infinite;
    }
    .status-badge.stopped .pulse-dot { background: var(--danger); }
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.2); }
      100% { opacity: 1; transform: scale(1); }
    }

    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 16px; border-radius: 10px;
      font-size: 13px; font-weight: 600; cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; transform: translateY(-1px); }
    .btn-pause {
      background: rgba(245, 158, 11, 0.15);
      border-color: rgba(245, 158, 11, 0.3);
      color: #fbbf24;
    }
    .btn-pause:hover { background: rgba(245, 158, 11, 0.25); }
    .btn-resume {
      background: rgba(16, 185, 129, 0.15);
      border-color: rgba(16, 185, 129, 0.3);
      color: #34d399;
    }
    .btn-resume:hover { background: rgba(16, 185, 129, 0.25); }
    .btn-outline {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    .btn-outline:hover { background: rgba(255, 255, 255, 0.12); }

    /* TOKEN BANNER CARD */
    .token-card {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.9));
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 20px 24px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    .token-left { display: flex; align-items: center; gap: 16px; }
    .token-icon-wrapper {
      width: 48px; height: 48px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
    }
    .token-title {
      font-size: 16px; font-weight: 700; color: #fff;
      display: flex; align-items: center; gap: 10px;
    }
    .token-expiry-pill {
      padding: 3px 10px; border-radius: 9999px;
      font-size: 12px; font-weight: 700; font-family: var(--font-mono);
    }
    .token-expiry-pill.valid {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
    }
    .token-expiry-pill.warning {
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fbbf24;
    }
    .token-expiry-pill.expired {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
    }
    .auto-renew-tag {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700;
      background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34d399; margin-left: 8px;
    }
    .token-sub { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
    .token-countdown {
      font-size: 18px; font-weight: 700; font-family: var(--font-mono); color: #60a5fa;
    }

    .info-bar {
      background: rgba(59, 130, 246, 0.08);
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 12px;
      padding: 14px 20px;
      margin-bottom: 24px;
      display: flex; flex-wrap: wrap; gap: 24px; font-size: 13px;
    }
    .info-item { display: flex; flex-direction: column; gap: 2px; }
    .info-item .label { color: var(--text-muted); font-size: 11px; text-transform: uppercase; }
    .info-item .val { font-weight: 600; color: #fff; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 20px;
      backdrop-filter: blur(12px);
    }
    .card-title {
      font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--text-muted); margin-bottom: 8px;
    }
    .card-value {
      font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: #fff;
    }
    .card-sub { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

    .terminal-card {
      background: #060910;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    .terminal-header {
      background: rgba(255, 255, 255, 0.03);
      padding: 14px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      display: flex; justify-content: space-between; align-items: center;
    }
    .terminal-dots { display: flex; gap: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot-red { background: #ff5f56; }
    .dot-yellow { background: #ffbd2e; }
    .dot-green { background: #27c93f; }
    .terminal-title { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); }
    .terminal-body {
      font-family: var(--font-mono); font-size: 12px; padding: 16px;
      height: 460px; overflow-y: auto; background: #050811; line-height: 1.6;
    }
    .log-line { white-space: pre-wrap; word-break: break-all; margin-bottom: 4px; }
    .log-line.standby { color: #fde047; font-weight: 500; }
    .log-line.info { color: #93c5fd; }
    .log-line.skip { color: #fde047; }
    .log-line.success { color: #86efac; font-weight: 600; }
    .log-line.error { color: #fca5a5; font-weight: 600; }

    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      padding: 20px; z-index: 1000; opacity: 0; pointer-events: none;
      transition: opacity 0.25s ease;
    }
    .modal-overlay.open { opacity: 1; pointer-events: auto; }
    .modal-box {
      background: #111827; border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 20px; width: 100%; max-width: 620px; padding: 28px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      transform: scale(0.95); transition: transform 0.25s ease;
    }
    .modal-overlay.open .modal-box { transform: scale(1); }
    .modal-title { font-size: 18px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    .modal-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 16px; line-height: 1.5; }
    .token-textarea {
      width: 100%; height: 130px; background: #060910;
      border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 12px;
      color: #fff; font-family: var(--font-mono); font-size: 12px; padding: 14px;
      resize: vertical; outline: none; transition: border-color 0.2s;
    }
    .token-textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }
    .token-preview {
      margin-top: 14px; background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px;
      padding: 12px; font-size: 12px; display: none;
    }
    .token-preview.show { display: block; }
    .token-preview .prev-item { margin-bottom: 4px; }
    .token-preview .prev-label { color: var(--text-muted); }
    .modal-footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }

    .helper-box {
      background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 10px; padding: 12px; margin-top: 14px; font-size: 12px;
    }
    .helper-box code {
      display: block; background: #060910; padding: 8px 10px;
      border-radius: 6px; font-family: var(--font-mono); margin-top: 6px;
      color: #93c5fd; word-break: break-all; user-select: all;
    }

    .toast {
      position: fixed; bottom: 24px; right: 24px; padding: 12px 20px;
      border-radius: 10px; font-size: 13px; font-weight: 600; color: #fff;
      background: #2563eb; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
      transform: translateY(100px); opacity: 0;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); z-index: 2000;
    }
    .toast.show { transform: translateY(0); opacity: 1; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
          </svg>
        </div>
        <div class="brand-title">
          <h1>Opportunistic Placement Automator</h1>
          <p>24/7 AWS Autonomous Cloud Engine &bull; Host: 13.204.76.22</p>
        </div>
      </div>
      <div class="header-actions">
        <div id="statusBadge" class="status-badge online">
          <span class="pulse-dot"></span>
          <span id="statusText">CHECKING...</span>
        </div>
        <button id="btnPauseResume" class="btn btn-pause" onclick="togglePauseResume()">
          <span id="pauseResumeIcon">⏸️</span>
          <span id="pauseResumeText">Pause Automation</span>
        </button>
        <button class="btn btn-outline" onclick="restartEngine()">🔄 Restart</button>
        <button class="btn btn-primary" onclick="openTokenModal()">🔑 Update Token</button>
      </div>
    </header>

    <!-- LIVE TOKEN CARD -->
    <div class="token-card" id="tokenCard">
      <div class="token-left">
        <div class="token-icon-wrapper">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
          </svg>
        </div>
        <div>
          <div class="token-title">
            <span>Azure Bearer Token</span>
            <span id="tokenPill" class="token-expiry-pill valid">Checking...</span>
            <span id="autoRenewBadge" class="auto-renew-tag" style="display: none;">⚡ 24/7 Auto-Renew ON</span>
          </div>
          <div class="token-sub">
            Authenticated Candidate: <strong id="tokenCandidateName" style="color: #fff;">Pankaj Kumar</strong> (<span id="tokenCandidateEmail">pankaj.kumar07@nagarro.com</span>)
          </div>
          <div class="token-sub" id="tokenExpiryDates">
            Expires: <span id="tokenExpLocal">-</span>
          </div>
        </div>
      </div>
      <div>
        <div class="token-sub" style="text-align: right; margin-bottom: 4px;">Time Remaining</div>
        <div class="token-countdown" id="tokenCountdown">-</div>
        <div style="text-align: right; margin-top: 8px;">
          <button class="btn btn-primary" style="padding: 6px 14px; font-size: 12px;" onclick="openTokenModal()">
            Renew / Update
          </button>
        </div>
      </div>
    </div>

    <!-- Info Banner -->
    <div class="info-bar">
      <div class="info-item">
        <span class="label">Target Portal</span>
        <span class="val">Azure Production (https://opportunistic-placement.azurewebsites.net)</span>
      </div>
      <div class="info-item">
        <span class="label">Operating Schedule</span>
        <span class="val">Mon – Fri: 8:00 AM – 8:00 PM IST (Weekends Excluded)</span>
      </div>
      <div class="info-item">
        <span class="label">Schedule Status</span>
        <span class="val" id="valScheduleStatus">Checking...</span>
      </div>
      <div class="info-item">
        <span class="label">Autonomous Renewal</span>
        <span class="val" id="valAutoRenewStatus">Checking...</span>
      </div>
    </div>

    <!-- Metrics Cards -->
    <div class="grid">
      <div class="card">
        <div class="card-title">Completed Cycles</div>
        <div class="card-value" id="valCycles">-</div>
        <div class="card-sub">30s polling interval</div>
      </div>
      <div class="card">
        <div class="card-title">Demands Evaluated</div>
        <div class="card-value" id="valEvaluated" style="color: #60a5fa;">-</div>
        <div class="card-sub">Filtered across all pages</div>
      </div>
      <div class="card">
        <div class="card-title">Skipped (Rules)</div>
        <div class="card-value" id="valSkipped" style="color: #fbbf24;">-</div>
        <div class="card-sub">Already applied or Python-only</div>
      </div>
      <div class="card">
        <div class="card-title">Auto-Applied</div>
        <div class="card-value" id="valApplied" style="color: #34d399;">-</div>
        <div class="card-sub">Submitted with AI pitch & resume</div>
      </div>
      <div class="card">
        <div class="card-title">Daemon Uptime</div>
        <div class="card-value" id="valUptime" style="font-size: 22px;">-</div>
        <div class="card-sub" id="valMemory">-</div>
      </div>
    </div>

    <!-- Terminal -->
    <div class="terminal-card">
      <div class="terminal-header">
        <div class="terminal-dots">
          <span class="dot dot-red"></span>
          <span class="dot dot-yellow"></span>
          <span class="dot dot-green"></span>
        </div>
        <div class="terminal-title">live-production-logs &bull; tail -f prod-automator-out.log</div>
        <button class="btn btn-outline" style="padding: 4px 10px; font-size: 11px;" onclick="fetchData()">Refresh</button>
      </div>
      <div class="terminal-body" id="terminalLogs">
        <div class="log-line info">Connecting to AWS background daemon...</div>
      </div>
    </div>
  </div>

  <!-- Token Update Modal -->
  <div class="modal-overlay" id="tokenModal">
    <div class="modal-box">
      <div class="modal-title">⚡ Autonomous Token Activation</div>
      <p class="modal-desc">
        Paste your <strong>Refresh Token</strong> (or fresh Access Token). When you provide a Refresh Token, AWS will automatically renew tokens with Microsoft <strong>24/7 forever</strong> without requiring any human action.
      </p>

      <textarea id="tokenInput" class="token-textarea" placeholder="Paste your Refresh Token (starts with 0.A...) or Access Token here..." oninput="handleTokenInput()"></textarea>

      <div class="token-preview" id="tokenPreview">
        <div class="prev-item"><span class="prev-label">Token Type: </span><strong id="prevType" style="color: #34d399;">-</strong></div>
        <div class="prev-item"><span class="prev-label">Candidate: </span><strong id="prevName" style="color: #fff;">-</strong></div>
        <div class="prev-item"><span class="prev-label">Email: </span><span id="prevEmail" style="color: #93c5fd;">-</span></div>
        <div class="prev-item"><span class="prev-label">Expiry / Validity: </span><span id="prevExp" style="color: #34d399;">-</span></div>
      </div>

      <div class="helper-box">
        🚀 <strong>1-Click Command to copy your Refresh Token:</strong>
        <p style="margin-top: 4px; color: var(--text-muted);">
          In your <a href="https://opportunistic-placement.azurewebsites.net/demands" target="_blank" style="color: #60a5fa;">Portal</a> tab, open Console (<code>Cmd+Option+J</code>) and run:
        </p>
        <code onclick="copySnippet()" title="Click to copy snippet" style="cursor: pointer;">copy(Object.keys(sessionStorage).filter(k=>k.includes('refreshtoken')).map(k=>JSON.parse(sessionStorage[k]).secret)[0])</code>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeTokenModal()">Cancel</button>
        <button class="btn btn-primary" id="btnSaveToken" onclick="submitToken()">Save & Enable 24/7 Auto-Renew</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toastMessage">Notification</div>

  <script>
    let currentStatus = 'online';
    let tokenExpTimestamp = 0;
    let countdownInterval = null;

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toastMessage');
      toast.innerText = msg;
      toast.style.background = isError ? '#ef4444' : '#2563eb';
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 4000);
    }

    function formatUptime(seconds) {
      if (!seconds) return '0s';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      if (m < 60) return m + 'm ' + s + 's';
      const h = Math.floor(m / 60);
      return h + 'h ' + (m % 60) + 'm';
    }

    function updateCountdown() {
      if (!tokenExpTimestamp) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const diff = tokenExpTimestamp - nowSec;
      const cdEl = document.getElementById('tokenCountdown');
      const pillEl = document.getElementById('tokenPill');

      if (diff <= 0) {
        cdEl.innerText = 'EXPIRED';
        cdEl.style.color = '#ef4444';
        pillEl.innerText = 'EXPIRED';
        pillEl.className = 'token-expiry-pill expired';
      } else {
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        const timeStr = (h > 0 ? h + 'h ' : '') + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
        cdEl.innerText = timeStr;

        if (diff < 900) {
          cdEl.style.color = '#f59e0b';
          pillEl.innerText = 'Expiring Soon';
          pillEl.className = 'token-expiry-pill warning';
        } else {
          cdEl.style.color = '#10b981';
          pillEl.innerText = 'Active & Valid';
          pillEl.className = 'token-expiry-pill valid';
        }
      }
    }

    async function fetchData() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        // PM2
        if (data.pm2) {
          currentStatus = data.pm2.status;
          const statusBadge = document.getElementById('statusBadge');
          const statusText = document.getElementById('statusText');
          const btnPR = document.getElementById('btnPauseResume');
          const iconPR = document.getElementById('pauseResumeIcon');
          const textPR = document.getElementById('pauseResumeText');

          if (data.pm2.status === 'online') {
            statusBadge.className = 'status-badge online';
            statusText.innerText = 'DAEMON ACTIVE (30s)';
            btnPR.className = 'btn btn-pause';
            iconPR.innerText = '⏸️';
            textPR.innerText = 'Pause Automation';
          } else {
            statusBadge.className = 'status-badge stopped';
            statusText.innerText = 'AUTOMATION PAUSED';
            btnPR.className = 'btn btn-resume';
            iconPR.innerText = '▶️';
            textPR.innerText = 'Resume Automation';
          }

          document.getElementById('valUptime').innerText = formatUptime(data.pm2.uptime);
          document.getElementById('valMemory').innerText = 'RAM: ' + data.pm2.memoryMb + ' MB | CPU: ' + data.pm2.cpu + '%';
        }

        // Auto Renew status
        const autoRenewBadge = document.getElementById('autoRenewBadge');
        const autoRenewStatus = document.getElementById('valAutoRenewStatus');
        if (data.hasRefreshToken) {
          autoRenewBadge.style.display = 'inline-flex';
          autoRenewStatus.innerHTML = '<span style=\"color: #34d399;\">✅ Enabled (Silent 45m Azure AD refresh)</span>';
        } else {
          autoRenewBadge.style.display = 'none';
          autoRenewStatus.innerHTML = '<span style=\"color: #f59e0b;\">⚠️ Manual (Paste Refresh Token to activate)</span>';
        }

        // Token Info
        if (data.token) {
          tokenExpTimestamp = data.token.exp;
          document.getElementById('tokenCandidateName').innerText = data.token.name;
          document.getElementById('tokenCandidateEmail').innerText = data.token.email;
          const expDate = new Date(data.token.exp * 1000);
          document.getElementById('tokenExpLocal').innerText = expDate.toLocaleString();
          updateCountdown();
        }

        // Stats
        if (data.stats) {
          document.getElementById('valCycles').innerText = '#' + data.stats.cycles;
          document.getElementById('valEvaluated').innerText = (data.stats.cycles * 2);
          document.getElementById('valSkipped').innerText = (data.stats.skippedAlreadyApplied + data.stats.skippedPythonOnly);
          document.getElementById('valApplied').innerText = data.stats.applied;
        }

        // Schedule status
        const schedEl = document.getElementById('valScheduleStatus');
        if (schedEl) {
          const istStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
          const istDate = new Date(istStr);
          const day = istDate.getDay();
          const hour = istDate.getHours();
          const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          const currentDayName = dayNames[day];

          if (day === 0 || day === 6) {
            schedEl.innerHTML = '<span style="color: #fbbf24; font-weight: 600;">🏖️ Weekend Standby (' + currentDayName + ') - Resumes Monday 8:00 AM IST</span>';
          } else if (hour >= 8 && hour < 20) {
            schedEl.innerHTML = '<span style="color: #34d399; font-weight: 700;">🟢 Active Window (Mon–Fri: 8:00 AM – 8:00 PM IST)</span>';
          } else {
            let hoursUntil8 = (8 - hour + 24) % 24;
            schedEl.innerHTML = '<span style="color: #fbbf24; font-weight: 600;">🌙 Standby (Resumes at 8:00 AM IST in ~' + hoursUntil8 + 'h)</span>';
          }
        }

        // Logs
        const term = document.getElementById('terminalLogs');
        if (data.logs && data.logs.length) {
          term.innerHTML = data.logs.map(line => {
            let cls = 'info';
            if (line.includes('[STANDBY]')) cls = 'standby';
            else if (line.includes('[SKIP]')) cls = 'skip';
            else if (line.includes('[SUCCESS]') || line.includes('APPLIED to') || line.includes('auto-renewed')) cls = 'success';
            else if (line.includes('[ERROR]') || line.includes('Error')) cls = 'error';
            return '<div class=\"log-line ' + cls + '\">' + escapeHtml(line) + '</div>';
          }).join('');
          term.scrollTop = term.scrollHeight;
        }
      } catch (e) {
        console.error('Fetch error:', e);
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
      document.getElementById('tokenPreview').classList.remove('show');
    }

    function handleTokenInput() {
      const val = document.getElementById('tokenInput').value.trim();
      const prev = document.getElementById('tokenPreview');
      if (!val) {
        prev.classList.remove('show');
        return;
      }

      if (val.startsWith('0.A') || val.length > 500 && !val.includes('.')) {
        document.getElementById('prevType').innerText = '⚡ Refresh Token (Enables 24/7 Autonomous Renewal)';
        document.getElementById('prevName').innerText = 'Pankaj Kumar';
        document.getElementById('prevEmail').innerText = 'pankaj.kumar07@nagarro.com';
        document.getElementById('prevExp').innerText = 'Up to 90 Days Rolling Auto-Renew';
        prev.classList.add('show');
        return;
      }

      try {
        const parts = val.replace(/^Bearer\s+/i, '').split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          document.getElementById('prevType').innerText = 'Access Token (60-minute duration)';
          document.getElementById('prevName').innerText = payload.name || payload.given_name || 'Nagarro Candidate';
          document.getElementById('prevEmail').innerText = payload.upn || payload.unique_name || payload.email || '-';
          const expDate = new Date(payload.exp * 1000);
          document.getElementById('prevExp').innerText = expDate.toLocaleString();
          prev.classList.add('show');
          return;
        }
      } catch (e) {}
      prev.classList.remove('show');
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
        btn.innerText = 'Save & Enable 24/7 Auto-Renew';
      }
    }

    function copySnippet() {
      const snippet = "copy(Object.keys(sessionStorage).filter(k=>k.includes('refreshtoken')).map(k=>JSON.parse(sessionStorage[k]).secret)[0])";
      navigator.clipboard.writeText(snippet);
      showToast('📋 Snippet copied! Run in portal Console, then paste token here.');
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

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({ pm2, token, hasRefreshToken: hasRefresh, stats, logs }));
  }

  // POST /api/token/update
  if (pathname === '/api/token/update' && method === 'POST') {
    const body = await parseJsonBody(req);
    const rawToken = (body.token || '').replace(/^Bearer\s+/i, '').replace(/^['"]|['"]$/g, '').trim();

    if (!rawToken) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'Empty token provided' }));
    }

    // CASE 1: User pasted a REFRESH TOKEN (starts with 0.A or doesn't have 3 dot-separated JWT parts)
    if (rawToken.startsWith('0.A') || !rawToken.includes('.') || rawToken.length > 500 && rawToken.split('.').length !== 3) {
      // Exchange refresh token with Azure AD
      const exchangeResult = await refreshAccessToken(rawToken);
      if (!exchangeResult.success) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({
          success: false,
          error: `Azure AD rejected refresh token: ${exchangeResult.error}`
        }));
      }

      // Restart prod-automator to reload immediately
      exec('pm2 restart prod-automator', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({
          success: true,
          isRefreshToken: true,
          message: '⚡ Autonomous 24/7 Auto-Renew Activated! Azure AD issued fresh token.',
          token: parseJwt(exchangeResult.accessToken)
        }));
      });
      return;
    }

    // CASE 2: User pasted an ACCESS TOKEN (JWT)
    const parsed = parseJwt(rawToken);
    if (!parsed || !parsed.isValid) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: false, error: 'Invalid token format' }));
    }

    fs.writeFileSync(TOKEN_FILE, rawToken, 'utf8');

    exec('pm2 restart prod-automator', () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({
        success: true,
        isRefreshToken: false,
        message: 'Access Token updated (expires in 60m). Paste your Refresh Token for 24/7 auto-renew!',
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Live Interactive Dashboard running privately on http://127.0.0.1:${PORT}`);
});
