import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { CONFIG, getRuntimeConfig, saveRuntimeConfig } from './config.js';
import { sendTestNtfyNotification } from './ntfy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // Strictly loopback only for zero-exposure security
const TOKEN_FILE = path.join(__dirname, 'token.txt');
const REFRESH_TOKEN_FILE = path.join(__dirname, 'refresh-token.txt');
const APPLIED_FILE = path.join(__dirname, 'applied-demands.json');
const STATS_FILE = path.join(__dirname, 'stats.json');

function getStoredStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }
  } catch (e) {}
  return null;
}
const LOG_FILE = path.join(process.env.HOME || '/home/ec2-user', '.pm2', 'logs', 'prod-automator-out.log');

let cachedLatency = 42;
let lastLatencyTime = 0;

async function checkPortalLatency() {
  if (Date.now() - lastLatencyTime < 15000) return cachedLatency;
  lastLatencyTime = Date.now();
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    await fetch('https://opportunistic-placement.azurewebsites.net', {
      method: 'HEAD',
      signal: controller.signal
    });
    clearTimeout(timeout);
    cachedLatency = Date.now() - start;
  } catch (e) {
    cachedLatency = Math.min(Date.now() - start, 999);
  }
  return cachedLatency;
}

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

function getAppliedDemandsList() {
  try {
    if (fs.existsSync(APPLIED_FILE)) {
      return JSON.parse(fs.readFileSync(APPLIED_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
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

  // Also include count from persistent applied file if available
  const saved = getAppliedDemandsList();
  if (saved.length > applied) {
    applied = saved.length;
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, shrink-to-fit=no, viewport-fit=cover">
  <meta name="theme-color" content="#07090e">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="format-detection" content="telephone=no">
  <title>Demand Automator • Mission Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #07090e;
      --card-bg: rgba(15, 23, 42, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #3b82f6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --purple: #8b5cf6;
      --text-main: #f3f4f6;
      --text-muted: #94a3b8;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100vh;
      max-height: 100vh;
      overflow: hidden;
      background-color: var(--bg);
      color: var(--text-main);
      font-family: var(--font-sans);
      line-height: 1.35;
      font-size: 13px;
      touch-action: pan-x pan-y;
      -webkit-text-size-adjust: 100%;
      -webkit-user-select: none;
      user-select: none;
    }
    input, textarea, .log-line, .applied-pitch-box {
      -webkit-user-select: text;
      user-select: text;
    }

    /* Single Screen Viewport Container */
    .app-viewport {
      height: 100vh;
      max-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 10px 14px;
      gap: 8px;
      box-sizing: border-box;
    }

    /* ========================================================
       1. Top Header Bar (Unified Desktop & Mobile)
       ======================================================== */
    header.app-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 12px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      backdrop-filter: blur(12px);
      flex-shrink: 0;
      gap: 12px;
    }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-icon {
      width: 32px; height: 32px;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
    }
    .brand-title h1 { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; }
    .brand-title p { font-size: 11px; color: var(--text-muted); }

    .header-center { display: flex; align-items: center; gap: 10px; }

    /* Interval Input Form */
    .interval-box {
      display: flex; align-items: center; gap: 5px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 3px 8px;
      font-size: 12px;
    }
    .interval-box label { color: var(--text-muted); font-size: 11px; text-transform: uppercase; font-weight: 600; }
    .interval-input {
      width: 44px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: #fff;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 700;
      text-align: center;
      padding: 2px 4px;
    }
    .interval-input:focus { outline: none; border-color: var(--primary); }
    .btn-save-interval {
      background: rgba(59, 130, 246, 0.2);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #60a5fa;
      border-radius: 5px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-save-interval:hover { background: #2563eb; color: #fff; }

    /* Standby Switch / Override */
    .standby-widget {
      display: flex; align-items: center; gap: 6px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 3px 8px;
    }
    .standby-badge {
      font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px;
    }
    .standby-badge.standby { background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .standby-badge.override { background: rgba(139, 92, 246, 0.2); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.4); }
    .standby-badge.active { background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .standby-badge.disabled-247 { background: rgba(245, 158, 11, 0.22); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.45); box-shadow: 0 0 10px rgba(245, 158, 11, 0.2); }

    .btn-override {
      font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 5px; cursor: pointer; border: 1px solid transparent; transition: all 0.15s;
    }
    .btn-override.force-run {
      background: linear-gradient(135deg, #d97706, #b45309);
      color: #fff;
      box-shadow: 0 2px 8px rgba(217, 119, 6, 0.4);
    }
    .btn-override.force-run:hover { background: #b45309; }
    .btn-override.restore-standby {
      background: rgba(139, 92, 246, 0.2);
      border-color: rgba(139, 92, 246, 0.4);
      color: #c084fc;
    }
    .btn-override.restore-standby:hover { background: rgba(139, 92, 246, 0.35); color: #fff; }

    /* Action buttons */
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 9999px;
      font-size: 11px; font-weight: 700;
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
    .pulse-dot { width: 6px; height: 6px; border-radius: 50%; }
    .status-badge.online .pulse-dot {
      background: var(--success);
      box-shadow: 0 0 8px var(--success);
      animation: pulse 2s infinite;
    }
    .status-badge.stopped .pulse-dot { background: var(--danger); }
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.3); }
      100% { opacity: 1; transform: scale(1); }
    }

    .btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 11px; border-radius: 7px;
      font-size: 11px; font-weight: 600; cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }
    .btn-pause {
      background: rgba(245, 158, 11, 0.15);
      border-color: rgba(245, 158, 11, 0.3);
      color: #fbbf24;
    }
    .btn-pause:hover { background: rgba(245, 158, 11, 0.28); }
    .btn-resume {
      background: rgba(16, 185, 129, 0.15);
      border-color: rgba(16, 185, 129, 0.3);
      color: #34d399;
    }
    .btn-resume:hover { background: rgba(16, 185, 129, 0.28); }
    .btn-outline {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.12);
      color: #fff;
    }
    .btn-outline:hover { background: rgba(255, 255, 255, 0.12); }
    .btn-token {
      background: linear-gradient(135deg, #1e40af, #2563eb);
      color: #fff;
    }
    .btn-token:hover { background: #1d4ed8; }
    .btn-history {
      background: rgba(16, 185, 129, 0.12);
      border-color: rgba(16, 185, 129, 0.3);
      color: #34d399;
    }
    .btn-history:hover { background: rgba(16, 185, 129, 0.22); }
    .btn-ntfy {
      background: rgba(59, 130, 246, 0.12);
      border-color: rgba(59, 130, 246, 0.35);
      color: #60a5fa;
    }
    .btn-ntfy:hover { background: rgba(59, 130, 246, 0.22); color: #fff; }
    .btn-sound {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.12);
      color: var(--text-muted);
    }
    .btn-sound.on {
      color: #60a5fa;
      border-color: rgba(96, 165, 250, 0.4);
      background: rgba(96, 165, 250, 0.1);
    }

    /* ========================================================
       2. Compact Status Strip (Desktop Default)
       ======================================================== */
    .status-strip {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr 1fr 0.6fr 1fr;
      gap: 8px;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid var(--card-border);
      border-radius: 9px;
      padding: 6px 12px;
      flex-shrink: 0;
      align-items: center;
    }
    .strip-item {
      display: flex; align-items: center; gap: 8px;
      font-size: 11.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .strip-label { color: var(--text-muted); font-size: 10px; text-transform: uppercase; font-weight: 600; }
    .strip-val { font-weight: 600; color: #fff; }
    .token-pill {
      font-family: var(--font-mono); font-size: 10.5px; font-weight: 700;
      padding: 2px 6px; border-radius: 4px;
    }
    .token-pill.valid { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .token-pill.warning { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .token-pill.expired { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }

    .latency-pill {
      font-family: var(--font-mono); font-size: 10.5px; font-weight: 700;
      padding: 2px 6px; border-radius: 4px;
      background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);
    }
    .latency-pill.fast { color: #34d399; border-color: rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.15); }
    .latency-pill.medium { color: #fbbf24; border-color: rgba(245, 158, 11, 0.3); background: rgba(245, 158, 11, 0.15); }
    .latency-pill.slow { color: #f87171; border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.15); }

    /* ========================================================
       3. Compact Metrics Row (Desktop Default)
       ======================================================== */
    .metrics-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      flex-shrink: 0;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 9px;
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.2s;
    }
    .metric-card.interactive { cursor: pointer; }
    .metric-card.interactive:hover { border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.05); }
    .metric-info { display: flex; flex-direction: column; }
    .metric-label { font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.04em; }
    .metric-value { font-size: 22px; font-weight: 800; color: #fff; font-family: var(--font-mono); line-height: 1.1; margin: 2px 0; }
    .metric-sub { font-size: 10px; color: var(--text-muted); }
    .metric-icon { font-size: 22px; opacity: 0.8; }

    /* ========================================================
       4. Terminal Section (Shared Engine Log Stream)
       ======================================================== */
    .terminal-wrapper {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: #020409;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
      overflow: hidden;
      position: relative;
    }
    .scroll-bottom-btn {
      position: absolute;
      bottom: 12px;
      right: 18px;
      background: rgba(37, 99, 235, 0.9);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 9999px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-sans);
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      opacity: 0;
      pointer-events: none;
      transform: translateY(6px);
      transition: opacity 0.2s ease, transform 0.2s ease, background 0.15s;
      z-index: 10;
    }
    .scroll-bottom-btn.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }
    .scroll-bottom-btn:hover {
      background: #1d4ed8;
      box-shadow: 0 6px 16px rgba(37, 99, 235, 0.5);
    }
    .terminal-header {
      background: rgba(255, 255, 255, 0.03);
      padding: 6px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      display: flex; justify-content: space-between; align-items: center;
      flex-shrink: 0;
    }
    .terminal-header-left { display: flex; align-items: center; gap: 8px; }
    .terminal-dots { display: flex; gap: 5px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; }
    .dot-red { background: #ff5f56; }
    .dot-yellow { background: #ffbd2e; }
    .dot-green { background: #27c93f; }
    .terminal-title { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); font-weight: 600; }
    .terminal-meta {
      font-size: 10px; font-family: var(--font-mono); color: #60a5fa;
    }
    .terminal-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.45;
      padding: 8px 12px;
      background: #020409;
    }
    .log-line { white-space: pre-wrap; word-break: break-all; margin-bottom: 3px; }
    .log-line.standby { color: #fde047; font-weight: 500; }
    .log-line.info { color: #93c5fd; }
    .log-line.skip { color: #fde047; }
    .log-line.success { color: #86efac; font-weight: 600; }
    .log-line.error { color: #fca5a5; font-weight: 600; }

    /* ========================================================
       5. Mobile Interactive Navigation Dock & Panes
       ======================================================== */
    .segmented-dock {
      display: flex;
      gap: 4px;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 3px;
      flex-shrink: 0;
      backdrop-filter: blur(12px);
    }
    .dock-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 7px 4px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-sans);
      border-radius: 7px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .dock-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.05); }
    .dock-btn.active {
      background: #2563eb;
      color: #fff;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
    }
    .dock-icon { font-size: 13px; }

    /* Tab Panes */
    .tab-pane {
      display: none;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      gap: 8px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }
    .tab-pane.active {
      display: flex;
    }
    .tab-pane::-webkit-scrollbar { width: 4px; }
    .tab-pane::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
    #pane-terminal { overflow-y: hidden; }

    /* Mobile HUD Ribbon */
    .terminal-hud-ribbon {
      display: flex;
      gap: 6px;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .hud-chip {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 7px;
      padding: 4px 6px;
      font-size: 11px;
      font-weight: 700;
      font-family: var(--font-mono);
      color: #fff;
    }
    .hud-chip.interactive { cursor: pointer; transition: all 0.15s; }
    .hud-chip.interactive:hover { border-color: #3b82f6; background: rgba(37, 99, 235, 0.15); }
    .hud-icon { font-size: 11px; }

    /* Log Filter Chips Bar */
    .log-filter-bar {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
      padding: 2px 2px;
    }
    .filter-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .filter-chip {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
      padding: 3px 9px;
      border-radius: 9999px;
      font-size: 10.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .filter-chip:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
    .filter-chip.active {
      background: rgba(37, 99, 235, 0.25);
      border-color: #3b82f6;
      color: #60a5fa;
      box-shadow: 0 1px 4px rgba(37, 99, 235, 0.3);
    }

    /* Mobile Telemetry & Controls Cards */
    .card-telemetry-profile {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      backdrop-filter: blur(12px);
    }
    .profile-header { display: flex; align-items: center; gap: 10px; }
    .profile-avatar {
      width: 32px; height: 32px;
      background: rgba(59, 130, 246, 0.2);
      border: 1px solid rgba(59, 130, 246, 0.4);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
    }
    .profile-name { font-size: 12.5px; font-weight: 700; color: #fff; }
    .profile-meta { font-size: 10.5px; color: var(--text-muted); }
    .profile-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .telemetry-pill {
      font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 4px;
      background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .card-server-stats {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 11px;
    }
    .server-stat-header { color: var(--text-muted); font-weight: 600; margin-bottom: 2px; }
    .server-stat-val { font-family: var(--font-mono); color: #60a5fa; font-weight: 600; }

    .control-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      backdrop-filter: blur(12px);
    }
    .control-card-header { display: flex; justify-content: space-between; align-items: center; }
    .control-title { font-size: 12.5px; font-weight: 700; color: #fff; }
    .control-desc { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
    .interval-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .preset-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: var(--text-main);
      padding: 6px 2px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .preset-btn:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
    .preset-btn.active {
      background: rgba(37, 99, 235, 0.3);
      border-color: #3b82f6;
      color: #60a5fa;
      font-weight: 700;
    }
    .interval-input-row { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--text-muted); }
    .control-actions-row { display: flex; gap: 8px; }
    .flex-1 { flex: 1; }
    .w-full { width: 100%; text-align: center; }
    .mt-2 { margin-top: 6px; }
    .badge-interval {
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.35);
      color: #60a5fa;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-weight: 700;
      font-size: 11px;
    }

    /* History Cards */
    .inline-history-header { display: flex; justify-content: space-between; align-items: center; padding: 2px 4px; }
    .inline-history-header h3 { font-size: 13px; font-weight: 700; color: #fff; }
    .badge-applied-count {
      font-size: 11px; background: rgba(16, 185, 129, 0.2); color: #34d399;
      padding: 2px 8px; border-radius: 9999px; font-weight: 700;
    }
    .inline-history-list { display: flex; flex-direction: column; gap: 8px; }
    .empty-history-state {
      text-align: center; padding: 40px 16px;
      background: rgba(15, 23, 42, 0.4);
      border: 1px dashed rgba(255, 255, 255, 0.1);
      border-radius: 10px;
    }
    .empty-icon { font-size: 32px; margin-bottom: 8px; }
    .empty-title { font-weight: 700; font-size: 13px; color: #fff; margin-bottom: 4px; }
    .empty-desc { font-size: 11.5px; color: var(--text-muted); line-height: 1.45; max-width: 380px; margin: 0 auto; }

    /* Slide-Over Drawer for Applied Demands History */
    .drawer-backdrop {
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(6px);
      z-index: 1500; opacity: 0; pointer-events: none;
      transition: opacity 0.25s ease;
    }
    .drawer-backdrop.open { opacity: 1; pointer-events: auto; }
    .drawer-panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: 480px; max-width: 90vw;
      background: #0d1424; border-left: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: -10px 0 40px rgba(0, 0, 0, 0.7);
      display: flex; flex-direction: column; z-index: 1501;
      transform: translateX(100%); transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .drawer-backdrop.open .drawer-panel { transform: translateX(0); }
    .drawer-header {
      padding: 14px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex; justify-content: space-between; align-items: center;
      background: rgba(255, 255, 255, 0.02); flex-shrink: 0;
    }
    .drawer-title { font-size: 15px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
    .drawer-close {
      background: rgba(255, 255, 255, 0.06); border: none; color: var(--text-muted);
      width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; font-size: 14px;
    }
    .drawer-close:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
    .drawer-body { flex: 1; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; }

    .applied-item-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 12px 14px;
      transition: all 0.2s;
    }
    .applied-item-card:hover { border-color: rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.03); }
    .applied-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .applied-id { font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: #34d399; }
    .applied-time { font-size: 11px; color: var(--text-muted); }
    .applied-role { font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 6px; }
    .applied-skills-box { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
    .applied-skill-tag {
      font-size: 10px; padding: 2px 6px; border-radius: 4px;
      background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);
    }
    .applied-pitch-box {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 6px; padding: 8px 10px; font-size: 11px;
      color: var(--text-muted); line-height: 1.45; max-height: 120px; overflow-y: auto;
    }

    /* Modal Overlay */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      padding: 20px; z-index: 1600; opacity: 0; pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .modal-overlay.open { opacity: 1; pointer-events: auto; }
    .modal-box {
      background: #0f172a; border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 14px; width: 100%; max-width: 540px; padding: 20px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
      transform: scale(0.96); transition: transform 0.2s ease;
    }
    .modal-overlay.open .modal-box { transform: scale(1); }
    .modal-title { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 6px; }
    .modal-desc { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; }
    .token-textarea {
      width: 100%; height: 90px;
      background: #060911; border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px; color: #fff; font-family: var(--font-mono);
      font-size: 11px; padding: 10px; resize: none; margin-bottom: 12px;
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

    /* ========================================================
       RESPONSIVE DISPLAY SWITCH: DESKTOP vs MOBILE
       ======================================================== */
    /* Desktop Rule (>= 801px) */
    @media (min-width: 801px) {
      .mobile-only {
        display: none !important;
      }
      .desktop-only {
        display: flex !important;
      }
      div.status-strip.desktop-only {
        display: grid !important;
      }
      div.metrics-row.desktop-only {
        display: grid !important;
      }
      #pane-terminal {
        display: flex !important;
        flex: 1 !important;
        min-height: 0 !important;
        overflow-y: hidden !important;
      }
      #pane-telemetry,
      #pane-controls,
      #pane-history {
        display: none !important;
      }
      .terminal-hud-ribbon {
        display: none !important;
      }
    }

    /* Mobile Rule (<= 800px) */
    @media (max-width: 800px) {
      .desktop-only,
      div.status-strip.desktop-only,
      div.metrics-row.desktop-only,
      .header-center,
      .header-actions button.desktop-only {
        display: none !important;
      }
      .mobile-only {
        display: flex !important;
      }
      nav.segmented-dock.mobile-only {
        display: flex !important;
      }
      .app-viewport {
        padding-top: max(8px, env(safe-area-inset-top));
        padding-bottom: max(16px, env(safe-area-inset-bottom));
        padding-left: max(10px, env(safe-area-inset-left));
        padding-right: max(10px, env(safe-area-inset-right));
      }
      .brand-title h1 { font-size: 13.5px; }
      .brand-title p { display: none; }
      .tab-pane {
        display: none !important;
      }
      .tab-pane.active {
        display: flex !important;
      }
      .modal-box { width: calc(100vw - 24px); }
      .toast { left: 14px; right: 14px; bottom: max(16px, env(safe-area-inset-bottom)); text-align: center; }
    }
  </style>
</head>
<body>

  <div class="app-viewport">
    
    <!-- 1. Header Bar (Full on Desktop, Compact on Mobile) -->
    <header class="app-header">
      <div class="brand">
        <div class="brand-icon">⚡</div>
        <div class="brand-title">
          <h1>Demand Automator <span id="statusBadge" class="status-badge stopped"><span class="pulse-dot"></span><span id="statusText">CHECKING...</span></span></h1>
          <p>Nagarro Opportunistic Placement • Autonomous Cloud Runner</p>
        </div>
      </div>

      <!-- Center Controls: Standby & Interval (Visible on Desktop) -->
      <div class="header-center desktop-only">
        <!-- Standby Status & Toggle -->
        <div class="standby-widget" title="Auto-Standby: Automatically sleeps outside Mon-Fri 8AM-8PM IST unless disabled">
          <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Standby:</span>
          <span id="badgeStandby" class="standby-badge standby">🌙 Standby</span>
          <button id="btnToggleStandby" class="btn-override force-run" onclick="toggleStandbyOverride()">
            ⚡ Disable (Run 24/7)
          </button>
        </div>

        <!-- Editable Interval -->
        <div class="interval-box">
          <label>Poll:</label>
          <input type="number" id="inputInterval" class="interval-input" min="5" max="3600" value="30" title="Cycle interval in seconds">
          <span style="color: var(--text-muted); font-size: 11px;">s (±3s jitter)</span>
          <button class="btn-save-interval" onclick="saveInterval()" title="Save & apply new interval">Save</button>
        </div>
      </div>

      <!-- Right Actions (Full on Desktop, Pause/Resume only on Mobile) -->
      <div class="header-actions">
        <!-- Desktop buttons -->
        <button class="btn btn-history desktop-only" onclick="toggleAppliedDrawer()" title="View history of all auto-applied demands">
          📋 History (<span id="appliedBadgeCount">0</span>)
        </button>

        <button id="btnSound" class="btn btn-sound on desktop-only" onclick="toggleSound()" title="Toggle audible chime when a demand is auto-applied">
          🔔 Sound: ON
        </button>

        <button class="btn btn-ntfy desktop-only" onclick="openNtfyModal()" title="Configure instant phone push alerts via ntfy.sh">
          🔔 Push Alerts
        </button>

        <!-- Always Visible Pause/Resume -->
        <button id="btnPauseResume" class="btn btn-pause" onclick="togglePauseResume()">
          <span id="iconPR">⏸️</span> <span id="textPR">Pause</span>
        </button>

        <button class="btn btn-outline desktop-only" onclick="restartEngine()" title="Restart engine process">
          🔄 Restart
        </button>

        <button class="btn btn-token desktop-only" onclick="openTokenModal()">
          🔑 Token
        </button>
      </div>
    </header>

    <!-- 2. Compact Status Strip (Desktop Only) -->
    <div class="status-strip desktop-only">
      <div class="strip-item">
        <span class="strip-label">Candidate:</span>
        <span id="stripCandidate" class="strip-val">Pankaj Kumar (pankaj.kumar07@nagarro.com)</span>
      </div>
      <div class="strip-item">
        <span class="strip-label">Token:</span>
        <span id="stripTokenPill" class="token-pill valid">Valid: --:--</span>
      </div>
      <div class="strip-item">
        <span class="strip-label">Entra ID:</span>
        <span id="stripAutoRenew" class="strip-val" style="color: #34d399;">✅ 45m Auto-Renew Active</span>
      </div>
      <div class="strip-item">
        <span class="strip-label">Portal:</span>
        <span id="stripLatencyPill" class="latency-pill fast">⚡ -- ms</span>
      </div>
      <div class="strip-item" style="justify-content: flex-end;">
        <span class="strip-label">Server:</span>
        <span id="stripServer" class="strip-val" style="font-family: var(--font-mono); font-size: 11px;">RAM: -- MB | CPU: --% | Up: --</span>
      </div>
    </div>

    <!-- 3. Compact Metrics Row (Desktop Only) -->
    <div class="metrics-row desktop-only">
      <div class="metric-card">
        <div class="metric-info">
          <span class="metric-label">Scan Cycles</span>
          <span id="valCycles" class="metric-value">#0</span>
          <span id="valLastScan" class="metric-sub">Last: Never</span>
        </div>
        <div class="metric-icon">🔄</div>
      </div>
      <div class="metric-card">
        <div class="metric-info">
          <span class="metric-label">Demands Evaluated</span>
          <span id="valEvaluated" class="metric-value">0</span>
          <span class="metric-sub">Gurugram & WFA</span>
        </div>
        <div class="metric-icon">🔍</div>
      </div>
      <div class="metric-card">
        <div class="metric-info">
          <span class="metric-label">Skipped Demands</span>
          <span id="valSkipped" class="metric-value">0</span>
          <span class="metric-sub">Python-Only / Applied</span>
        </div>
        <div class="metric-icon">⏭️</div>
      </div>
      <div class="metric-card interactive" onclick="toggleAppliedDrawer()" title="Click to view history of auto-applied demands">
        <div class="metric-info">
          <span class="metric-label">Auto-Applied (View 📋)</span>
          <span id="valApplied" class="metric-value" style="color: #34d399;">0</span>
          <span class="metric-sub">Frontend / Full-stack</span>
        </div>
        <div class="metric-icon">🎯</div>
      </div>
    </div>

    <!-- 4. Interactive Navigation Dock (Visible on Mobile ONLY) -->
    <nav class="segmented-dock mobile-only">
      <button class="dock-btn active" id="tabBtn-terminal" onclick="switchTab('terminal', this)">
        <span class="dock-icon">📟</span>
        <span class="dock-label">Terminal</span>
      </button>
      <button class="dock-btn" id="tabBtn-telemetry" onclick="switchTab('telemetry', this)">
        <span class="dock-icon">📊</span>
        <span class="dock-label">Stats</span>
      </button>
      <button class="dock-btn" id="tabBtn-controls" onclick="switchTab('controls', this)">
        <span class="dock-icon">⚙️</span>
        <span class="dock-label">Controls</span>
      </button>
      <button class="dock-btn" id="tabBtn-history" onclick="switchTab('history', this)">
        <span class="dock-icon">📋</span>
        <span class="dock-label">Demands (<span id="dockBadgeCount">0</span>)</span>
      </button>
    </nav>

    <!-- Pane 1: Terminal Viewport (Shared by Desktop and Mobile) -->
    <div id="pane-terminal" class="tab-pane active">
      <!-- Live HUD Summary Ribbon (Mobile Only) -->
      <div class="terminal-hud-ribbon mobile-only">
        <div class="hud-chip"><span class="hud-icon">🔄</span><span id="hudCycles">#0</span></div>
        <div class="hud-chip"><span class="hud-icon">⚡</span><span id="hudPing">--ms</span></div>
        <div class="hud-chip"><span class="hud-icon">🔑</span><span id="hudToken">--m</span></div>
        <div class="hud-chip interactive" onclick="switchTab('history')"><span class="hud-icon">🎯</span><span id="hudApplied">0 Applied</span></div>
      </div>

      <!-- Interactive Log Filter Bar -->
      <div class="log-filter-bar">
        <span class="filter-label">Filter:</span>
        <button class="filter-chip active" onclick="setLogFilter('all', this)">🔍 All</button>
        <button class="filter-chip" onclick="setLogFilter('applied', this)">🎯 Applied</button>
        <button class="filter-chip" onclick="setLogFilter('skip', this)">⏭️ Skips</button>
        <button class="filter-chip" onclick="setLogFilter('error', this)">⚠️ Errors</button>
      </div>

      <!-- Terminal Viewport Box -->
      <div class="terminal-wrapper">
        <div class="terminal-header">
          <div class="terminal-header-left">
            <div class="terminal-dots">
              <div class="dot dot-red"></div>
              <div class="dot dot-yellow"></div>
              <div class="dot dot-green"></div>
            </div>
            <div class="terminal-title">LIVE CLOUD TELEMETRY • AWS EC2 (Mumbai ap-south-1)</div>
          </div>
          <div id="terminalMeta" class="terminal-meta">PM2 PID: -- • Mon-Fri (8AM-8PM IST)</div>
        </div>
        <div id="terminalLogs" class="terminal-body" onscroll="handleTerminalScroll()">
          <div class="log-line info">Connecting to AWS cloud logs...</div>
        </div>
        <button id="btnScrollToBottom" class="scroll-bottom-btn" onclick="scrollTerminalToBottom()" title="Jump to latest logs">
          ↓ Jump to Latest
        </button>
      </div>
    </div>

    <!-- Pane 2: Mobile Telemetry & Metrics (Mobile Only) -->
    <div id="pane-telemetry" class="tab-pane mobile-only">
      <!-- Candidate & Account Card -->
      <div class="card-telemetry-profile">
        <div class="profile-header">
          <div class="profile-avatar">👤</div>
          <div class="profile-info">
            <div class="profile-name" id="mobCandidate">Pankaj Kumar (pankaj.kumar07@nagarro.com)</div>
            <div class="profile-meta">Nagarro Opportunistic Placement • Active Candidate</div>
          </div>
        </div>
        <div class="profile-badges">
          <span id="mobTokenPill" class="token-pill valid">Valid: --:--</span>
          <span id="mobAutoRenew" class="telemetry-pill">✅ 45m Auto-Renew Active</span>
          <span id="mobLatencyPill" class="latency-pill fast">⚡ -- ms</span>
        </div>
      </div>

      <!-- 4 Key Operational Metrics Cards -->
      <div class="metrics-row" style="grid-template-columns: repeat(2, 1fr);">
        <div class="metric-card">
          <div class="metric-info">
            <span class="metric-label">Scan Cycles</span>
            <span id="mobCycles" class="metric-value">#0</span>
            <span id="mobLastScan" class="metric-sub">Last: Never</span>
          </div>
          <div class="metric-icon">🔄</div>
        </div>
        <div class="metric-card">
          <div class="metric-info">
            <span class="metric-label">Demands Evaluated</span>
            <span id="mobEvaluated" class="metric-value">0</span>
            <span class="metric-sub">Gurugram & WFA</span>
          </div>
          <div class="metric-icon">🔍</div>
        </div>
        <div class="metric-card">
          <div class="metric-info">
            <span class="metric-label">Skipped Demands</span>
            <span id="mobSkipped" class="metric-value">0</span>
            <span class="metric-sub">Python-Only / Applied</span>
          </div>
          <div class="metric-icon">⏭️</div>
        </div>
        <div class="metric-card interactive" onclick="switchTab('history')" title="View history of auto-applied demands">
          <div class="metric-info">
            <span class="metric-label">Auto-Applied (View 📋)</span>
            <span id="mobApplied" class="metric-value" style="color: #34d399;">0</span>
            <span class="metric-sub">Frontend / Full-stack</span>
          </div>
          <div class="metric-icon">🎯</div>
        </div>
      </div>

      <!-- AWS EC2 Host Metrics -->
      <div class="card-server-stats">
        <div class="server-stat-header">
          <span>🖥️ AWS Cloud Server (Mumbai ap-south-1)</span>
        </div>
        <div class="server-stat-val" id="mobServer">RAM: -- MB | CPU: --% | Up: --</div>
      </div>
    </div>

    <!-- Pane 3: Mobile Controls & Settings (Mobile Only) -->
    <div id="pane-controls" class="tab-pane mobile-only">
      <!-- Auto-Standby Schedule Setting -->
      <div class="control-card">
        <div class="control-card-header">
          <div class="control-title">⚡ Autonomous Standby Schedule</div>
          <span id="mobBadgeStandby" class="standby-badge standby">🌙 Standby</span>
        </div>
        <p class="control-desc">Automatically sleeps outside Mon-Fri 8AM-8PM IST to preserve portal tokens, or run 24/7 continuously.</p>
        <button id="mobBtnToggleStandby" class="btn-override force-run w-full" onclick="toggleStandbyOverride()">
          ⚡ Disable (Run 24/7)
        </button>
      </div>

      <!-- Cycle Poll Interval -->
      <div class="control-card">
        <div class="control-card-header">
          <div class="control-title">⏱️ Cycle Poll Frequency</div>
          <span class="badge-interval"><span id="lblActiveInterval">30</span>s</span>
        </div>
        <p class="control-desc">Time between autonomous portal scans (applies ±3s human jitter).</p>
        
        <!-- Quick Preset Buttons -->
        <div class="interval-presets">
          <button class="preset-btn" onclick="setQuickInterval(15)">15s</button>
          <button class="preset-btn active" onclick="setQuickInterval(30)">30s (Default)</button>
          <button class="preset-btn" onclick="setQuickInterval(45)">45s</button>
          <button class="preset-btn" onclick="setQuickInterval(60)">60s</button>
        </div>

        <div class="interval-input-row">
          <label>Custom:</label>
          <input type="number" id="mobInputInterval" class="interval-input" min="5" max="3600" value="30">
          <span>seconds</span>
          <button class="btn-save-interval" onclick="saveMobInterval()">Save</button>
        </div>
      </div>

      <!-- Alerts & Notifications -->
      <div class="control-card">
        <div class="control-card-header">
          <div class="control-title">🔔 Notifications & Sounds</div>
        </div>
        <div class="control-actions-row">
          <button id="mobBtnSound" class="btn btn-sound on flex-1" onclick="toggleSound()">
            🔔 Sound: ON
          </button>
          <button class="btn btn-outline" onclick="testSound()">
            🔊 Test Chime
          </button>
        </div>
        <div class="control-actions-row mt-2">
          <button class="btn btn-ntfy flex-1" onclick="openNtfyModal()">
            📲 Push Alerts (ntfy.sh)
          </button>
          <button class="btn btn-outline" onclick="testNtfy()">
            Test Push
          </button>
        </div>
      </div>

      <!-- Security & Process Actions -->
      <div class="control-card">
        <div class="control-card-header">
          <div class="control-title">🔑 Entra ID Token & Engine Process</div>
        </div>
        <div class="control-actions-row">
          <button class="btn btn-token flex-1" onclick="openTokenModal()">
            🔑 Paste / Update Token
          </button>
          <button class="btn btn-outline" onclick="restartEngine()">
            🔄 Restart Engine
          </button>
        </div>
      </div>
    </div>

    <!-- Pane 4: Mobile Applied Demands History (Mobile Only) -->
    <div id="pane-history" class="tab-pane mobile-only">
      <div class="inline-history-header">
        <h3>📋 Auto-Applied Demands</h3>
        <span id="mobAppliedBadgeCount" class="badge-applied-count">0 Total</span>
      </div>
      <div id="inlineHistoryList" class="inline-history-list">
        <div class="empty-history-state">
          <div class="empty-icon">📭</div>
          <div class="empty-title">No Demands Auto-Applied Yet</div>
          <div class="empty-desc">When qualified Frontend or Full-stack demands match your active filters, they will be automatically submitted and displayed here with their full AI pitch.</div>
        </div>
      </div>
    </div>

  </div>

  <!-- Slide-Over Drawer for Applied Demands History (Desktop) -->
  <div id="appliedDrawerBackdrop" class="drawer-backdrop" onclick="if(event.target===this) toggleAppliedDrawer(false)">
    <div class="drawer-panel">
      <div class="drawer-header">
        <div class="drawer-title">
          <span>📋 Auto-Applied Demands</span>
          <span id="drawerBadgeCount" style="font-size: 11px; background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 2px 8px; border-radius: 9999px;">0 Total</span>
        </div>
        <button class="drawer-close" onclick="toggleAppliedDrawer(false)">✕</button>
      </div>
      <div id="drawerBody" class="drawer-body">
        <div style="text-align: center; color: var(--text-muted); padding: 40px 20px;">
          <div style="font-size: 32px; margin-bottom: 10px;">📭</div>
          <div style="font-weight: 600; color: #fff; margin-bottom: 4px;">No Demands Auto-Applied Yet</div>
          <div style="font-size: 12px; line-height: 1.5;">When qualified Frontend or Full-stack demands match your active filters, they will be automatically submitted and recorded here with their full AI pitch.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ntfy Push Notification Modal -->
  <div id="ntfyModal" class="modal-overlay" onclick="if(event.target===this) closeNtfyModal()">
    <div class="modal-box">
      <div class="modal-title">📲 Instant Push Notifications (ntfy.sh)</div>
      <div class="modal-desc">
        Receive instant notifications on your phone whenever an application is submitted or a critical event occurs — free, no account needed.
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer;">
          <input type="checkbox" id="chkNtfyEnable" style="width: 16px; height: 16px;">
          <span>Enable ntfy.sh Mobile Alerts</span>
        </label>
      </div>
      <div style="margin-bottom: 14px;">
        <label style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">Your Private Topic Name</label>
        <input type="text" id="inputNtfyTopic" placeholder="e.g. nagarro-demands-pankaj-9482" style="width: 100%; background: #060911; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff; font-family: var(--font-mono); font-size: 12px; padding: 8px 10px;">
        <span style="display: block; font-size: 10.5px; color: var(--text-muted); margin-top: 4px;">
          Install the free <strong>ntfy app</strong> on your phone (iOS / Android), tap <em>Subscribe</em>, and enter this exact topic name.
        </span>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeNtfyModal()">Cancel</button>
        <button class="btn btn-token" onclick="saveNtfyConfig()">Save Alerts Configuration</button>
      </div>
    </div>
  </div>

  <!-- Token Paste Modal -->
  <div id="tokenModal" class="modal-overlay" onclick="if(event.target===this) closeTokenModal()">
    <div class="modal-box">
      <div class="modal-title">🔑 Update Entra ID Session Token</div>
      <div class="modal-desc">
        Paste a freshly grabbed Bearer Token from your browser's DevTools Network tab (<code style="color: #60a5fa;">portal.nagarro.com</code>). The runner will immediately adopt it.
      </div>
      <textarea id="tokenInput" class="token-textarea" placeholder="Paste eyJhbGciOi... here"></textarea>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeTokenModal()">Cancel</button>
        <button class="btn btn-token" onclick="submitNewToken()">Apply Token</button>
      </div>
    </div>
  </div>

  <!-- Toast Notification -->
  <div id="toast" class="toast">Action notification</div>

  <script>
    // Completely disable iOS Safari pinch-to-zoom gestures
    document.addEventListener('gesturestart', function(e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturechange', function(e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('gestureend', function(e) { e.preventDefault(); }, { passive: false });

    // Block 2+ finger pinch touchmove
    document.addEventListener('touchstart', function(e) {
      if (e.touches && e.touches.length > 1) {
        e.preventDefault();
      }
    }, { passive: false });

    document.addEventListener('touchmove', function(e) {
      if (e.touches && e.touches.length > 1) {
        e.preventDefault();
      }
    }, { passive: false });

    // Prevent double-tap to zoom on iOS
    let lastTouchTime = 0;
    document.addEventListener('touchend', function(e) {
      const now = Date.now();
      if (now - lastTouchTime <= 300) {
        const tag = e.target.tagName;
        if (tag !== 'INPUT' && tag !== 'BUTTON' && tag !== 'TEXTAREA') {
          e.preventDefault();
        }
      }
      lastTouchTime = now;
    }, { passive: false });

    let currentStatus = 'unknown';
    let tokenExpTimestamp = 0;
    let countdownInterval = null;
    let isAutoStandby = true;
    let isOverrideActive = false;
    let currentInterval = 30;
    let previousAppliedCount = 0;
    let soundEnabled = localStorage.getItem('soundAlerts') !== 'false';
    let appliedHistoryData = [];
    let currentNtfyConfig = { enabled: false, topic: "" };
    let previousLogsHtml = '';
    let currentTab = 'terminal';
    let currentLogFilter = 'all';

    function setElText(id, text) {
      const el = document.getElementById(id);
      if (el) el.innerText = text;
    }
    function setElHtml(id, html) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    }

    function switchTab(tab, btn) {
      currentTab = tab;
      document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
      const targetBtn = btn || document.getElementById('tabBtn-' + tab);
      if (targetBtn) targetBtn.classList.add('active');

      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      const targetPane = document.getElementById('pane-' + tab);
      if (targetPane) targetPane.classList.add('active');

      if (tab === 'terminal') {
        const term = document.getElementById('terminalLogs');
        if (term) term.scrollTop = term.scrollHeight;
      }
    }

    function setLogFilter(filter, btn) {
      currentLogFilter = filter;
      document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      previousLogsHtml = '';
      fetchData();
    }

    function setQuickInterval(sec) {
      document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.toggle('active', b.innerText.startsWith(sec + 's'));
      });
      const input = document.getElementById('inputInterval');
      if (input) input.value = sec;
      const mobInput = document.getElementById('mobInputInterval');
      if (mobInput) mobInput.value = sec;
      saveInterval();
    }

    function saveMobInterval() {
      const mobInput = document.getElementById('mobInputInterval');
      if (mobInput) {
        const input = document.getElementById('inputInterval');
        if (input) input.value = mobInput.value;
      }
      saveInterval();
    }

    function testSound() {
      playChime();
      showToast('🔊 Played test notification chime!');
    }

    function renderInlineHistory(items) {
      const container = document.getElementById('inlineHistoryList');
      if (!container) return;
      if (!items || !items.length) {
        container.innerHTML = \`<div class="empty-history-state">
          <div class="empty-icon">📭</div>
          <div class="empty-title">No Demands Auto-Applied Yet</div>
          <div class="empty-desc">When qualified Frontend or Full-stack demands match your active filters, they will be automatically submitted and displayed here with their full AI pitch.</div>
        </div>\`;
        return;
      }
      container.innerHTML = items.slice().reverse().map(item => {
        const skillsHtml = (item.skills || []).map(s => \`<span class="applied-skill-tag">\${escapeHtml(s)}</span>\`).join('');
        return \`<div class="applied-item-card">
          <div class="applied-top">
            <span class="applied-id">Demand #\${escapeHtml(String(item.demandId || '--'))}</span>
            <span class="applied-time">\${item.appliedAt ? new Date(item.appliedAt).toLocaleTimeString() : 'Just now'}</span>
          </div>
          <div class="applied-role">\${escapeHtml(item.genus || item.role || 'Frontend Engineer')}</div>
          \${skillsHtml ? \`<div class="applied-skills-box">\${skillsHtml}</div>\` : ''}
          <div class="applied-pitch-box">
            <strong style="color: #60a5fa; display: block; margin-bottom: 2px;">Submitted Pitch:</strong>
            \${escapeHtml(item.pitch || 'Tailored pitch submitted.')}
          </div>
        </div>\`;
      }).join('');
    }

    function renderDrawerHistory() {
      const container = document.getElementById('drawerBody');
      if (!container) return;
      if (!appliedHistoryData || appliedHistoryData.length === 0) {
        container.innerHTML = \`
          <div style="text-align: center; color: var(--text-muted); padding: 40px 20px;">
            <div style="font-size: 32px; margin-bottom: 10px;">📭</div>
            <div style="font-weight: 600; color: #fff; margin-bottom: 4px;">No Demands Auto-Applied Yet</div>
            <div style="font-size: 12px; line-height: 1.5;">When qualified Frontend or Full-stack demands match your active filters, they will be automatically submitted and recorded here with their full AI pitch.</div>
          </div>
        \`;
        return;
      }

      container.innerHTML = appliedHistoryData.map(item => {
        const timeStr = item.appliedAt ? new Date(item.appliedAt).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'Recently';
        const skillsList = Array.isArray(item.skills) ? item.skills : [];
        return \`
          <div class="applied-item-card">
            <div class="applied-top">
              <span class="applied-id">Demand #\${escapeHtml(String(item.demandId))}</span>
              <span class="applied-time">\${timeStr}</span>
            </div>
            <div class="applied-role">\${escapeHtml(item.genus || 'Role')} • <span style="font-size: 11px; font-weight: normal; color: var(--text-muted);">\${escapeHtml(item.location || 'India')}</span></div>
            \${skillsList.length ? \`
              <div class="applied-skills-box">
                \${skillsList.map(s => \`<span class="applied-skill-tag">\${escapeHtml(String(s))}</span>\`).join('')}
              </div>
            \` : ''}
            <div class="applied-pitch-box">
              <strong style="color: #60a5fa; display: block; margin-bottom: 3px;">Submitted Pitch:</strong>
              \${escapeHtml(item.pitch || 'Authentic resume and pitch submitted.')}
            </div>
          </div>
        \`;
      }).join('');
    }

    function handleTerminalScroll() {
      const term = document.getElementById('terminalLogs');
      const btn = document.getElementById('btnScrollToBottom');
      if (!term || !btn) return;
      const isScrolledUp = (term.scrollHeight - term.scrollTop - term.clientHeight) > 50;
      if (isScrolledUp) {
        btn.classList.add('visible');
      } else {
        btn.classList.remove('visible');
      }
    }

    function scrollTerminalToBottom() {
      const term = document.getElementById('terminalLogs');
      if (!term) return;
      term.scrollTop = term.scrollHeight;
      handleTerminalScroll();
    }

    function toggleAppliedDrawer(forceOpen) {
      const backdrop = document.getElementById('appliedDrawerBackdrop');
      if (!backdrop) return;
      if (typeof forceOpen === 'boolean') {
        backdrop.classList.toggle('open', forceOpen);
      } else {
        backdrop.classList.toggle('open');
      }
      if (backdrop.classList.contains('open')) {
        renderDrawerHistory();
      }
    }

    function playChime() {
      if (!soundEnabled) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        function playTone(freq, start, duration) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
          gain.gain.setValueAtTime(0.2, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + duration);
        }

        playTone(523.25, 0.0, 0.15); // C5
        playTone(659.25, 0.12, 0.15); // E5
        playTone(783.99, 0.24, 0.35); // G5
      } catch (e) {
        console.warn('Audio chime error:', e);
      }
    }

    function toggleSound() {
      soundEnabled = !soundEnabled;
      localStorage.setItem('soundAlerts', soundEnabled ? 'true' : 'false');
      const text = soundEnabled ? '🔔 Sound: ON' : '🔕 Sound: OFF';
      
      const btn = document.getElementById('btnSound');
      if (btn) {
        btn.className = 'btn btn-sound' + (soundEnabled ? ' on' : '');
        btn.innerText = text;
      }
      const mobBtn = document.getElementById('mobBtnSound');
      if (mobBtn) {
        mobBtn.className = 'btn btn-sound' + (soundEnabled ? ' on flex-1' : ' flex-1');
        mobBtn.innerText = text;
      }
      showToast(soundEnabled ? '🔔 Sound chime alerts enabled' : '🔕 Sound chime alerts silenced');
    }

    function updateCountdown() {
      const el = document.getElementById('stripTokenPill');
      const mobEl = document.getElementById('mobTokenPill');
      const hudToken = document.getElementById('hudToken');

      if (!tokenExpTimestamp) {
        if (el) { el.innerText = 'No Token'; el.className = 'token-pill expired'; }
        if (mobEl) { mobEl.innerText = 'No Token'; mobEl.className = 'token-pill expired'; }
        if (hudToken) hudToken.innerText = 'No Token';
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const diff = tokenExpTimestamp - now;
      if (diff <= 0) {
        const expText = 'Expired (Auto-renewing...)';
        if (el) { el.innerText = expText; el.className = 'token-pill expired'; }
        if (mobEl) { mobEl.innerText = expText; mobEl.className = 'token-pill expired'; }
        if (hudToken) hudToken.innerText = 'Expired';
      } else {
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        const validText = 'Valid: ' + m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        const cls = (diff > 900) ? 'token-pill valid' : (diff > 300 ? 'token-pill warning' : 'token-pill expired');
        
        if (el) { el.innerText = validText; el.className = cls; }
        if (mobEl) { mobEl.innerText = validText; mobEl.className = cls; }
        if (hudToken) hudToken.innerText = m + 'm left';
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
            if (badge) badge.className = 'status-badge online';
            if (text) text.innerText = 'ONLINE';
            if (btnPR) btnPR.className = 'btn btn-pause';
            if (iconPR) iconPR.innerText = '⏸️';
            if (textPR) textPR.innerText = 'Pause';
          } else {
            if (badge) badge.className = 'status-badge stopped';
            if (text) text.innerText = 'PAUSED';
            if (btnPR) btnPR.className = 'btn btn-resume';
            if (iconPR) iconPR.innerText = '▶️';
            if (textPR) textPR.innerText = 'Resume';
          }

          const srvStr = 'RAM: ' + data.pm2.memoryMb + ' MB | CPU: ' + data.pm2.cpu + '% | Up: ' + formatUptime(data.pm2.uptime);
          setElText('stripServer', srvStr);
          setElText('mobServer', srvStr);

          const tMeta = document.getElementById('terminalMeta');
          if (tMeta) tMeta.innerText = 'PM2: ' + currentStatus.toUpperCase() + ' (RAM: ' + data.pm2.memoryMb + 'MB) • ' + (data.runtimeConfig?.pollIntervalSeconds || 30) + 's (±3s jitter)';
        }

        // Latency
        if (typeof data.latency === 'number') {
          const latText = '⚡ ' + data.latency + ' ms';
          const latCls = (data.latency < 150) ? 'latency-pill fast' : (data.latency < 450 ? 'latency-pill medium' : 'latency-pill slow');
          
          const latEl = document.getElementById('stripLatencyPill');
          if (latEl) { latEl.innerText = latText; latEl.className = latCls; }
          const mobLatEl = document.getElementById('mobLatencyPill');
          if (mobLatEl) { mobLatEl.innerText = latText; mobLatEl.className = latCls; }
          setElText('hudPing', data.latency + 'ms');
        }

        // Runtime Config: Interval & Auto-Standby
        if (data.runtimeConfig) {
          isAutoStandby = data.runtimeConfig.autoStandby !== undefined
            ? Boolean(data.runtimeConfig.autoStandby)
            : !Boolean(data.runtimeConfig.standbyOverride);
          isOverrideActive = !isAutoStandby;
          currentInterval = data.runtimeConfig.pollIntervalSeconds || 30;
          if (data.runtimeConfig.ntfy) {
            currentNtfyConfig = data.runtimeConfig.ntfy;
          } else if (data.runtimeConfig.whatsapp) {
            currentNtfyConfig = { enabled: data.runtimeConfig.whatsapp.enabled, topic: data.runtimeConfig.whatsapp.topic || "" };
          }

          const inputInt = document.getElementById('inputInterval');
          if (inputInt && document.activeElement !== inputInt) {
            inputInt.value = currentInterval;
          }
          const mobInputInt = document.getElementById('mobInputInterval');
          if (mobInputInt && document.activeElement !== mobInputInt) {
            mobInputInt.value = currentInterval;
          }
          setElText('lblActiveInterval', currentInterval);

          updateStandbyUI();
        }

        // Token Info
        if (data.token) {
          tokenExpTimestamp = data.token.exp;
          const candStr = data.token.name + ' (' + data.token.email + ')';
          setElText('stripCandidate', candStr);
          setElText('mobCandidate', candStr);
          updateCountdown();
        }

        // Auto Renew
        const arHtml = data.hasRefreshToken 
          ? '<span style="color: #34d399;">✅ 45m Auto-Renew Active</span>'
          : '<span style="color: #f59e0b;">⚠️ Manual Token Only</span>';
        setElHtml('stripAutoRenew', arHtml);
        setElHtml('mobAutoRenew', arHtml);

        // Applied History Data & Sound Chime
        if (Array.isArray(data.appliedHistory)) {
          appliedHistoryData = data.appliedHistory;
          const currentCount = appliedHistoryData.length;
          
          setElText('appliedBadgeCount', currentCount);
          setElText('drawerBadgeCount', currentCount + ' Total');
          setElText('mobAppliedBadgeCount', currentCount + ' Total');
          setElText('dockBadgeCount', currentCount);
          setElText('hudApplied', currentCount + ' Applied');

          renderDrawerHistory();
          renderInlineHistory(appliedHistoryData);

          if (previousAppliedCount > 0 && currentCount > previousAppliedCount) {
            playChime();
            showToast('🎉 NEW JOB APPLICATION SUBMITTED!');
          }
          previousAppliedCount = currentCount;
        }

        // Stats
        if (data.stats) {
          const cycles = data.stats.cyclesCount !== undefined ? data.stats.cyclesCount : data.stats.cycles;
          const evaluated = data.stats.totalEvaluated !== undefined ? data.stats.totalEvaluated : cycles;
          const skipped = data.stats.totalSkippedAlreadyApplied !== undefined
            ? ((data.stats.totalSkippedAlreadyApplied || 0) + (data.stats.totalSkippedPythonOnly || 0))
            : ((data.stats.skippedAlreadyApplied || 0) + (data.stats.skippedPythonOnly || 0));
          const applied = data.stats.totalApplied !== undefined ? data.stats.totalApplied : data.stats.applied;

          setElText('valCycles', '#' + cycles);
          setElText('mobCycles', '#' + cycles);
          setElText('hudCycles', '#' + cycles);

          setElText('valEvaluated', evaluated);
          setElText('mobEvaluated', evaluated);

          setElText('valSkipped', skipped);
          setElText('mobSkipped', skipped);

          setElText('valApplied', applied);
          setElText('mobApplied', applied);
          
          let lastTimeStr = data.stats.lastScan;
          if (data.stats.lastCycleTime) {
            try {
              lastTimeStr = new Date(data.stats.lastCycleTime).toLocaleTimeString("en-US", { hour12: false, timeZone: "Asia/Kolkata" });
            } catch(e) {}
          }
          setElText('valLastScan', 'Last: ' + lastTimeStr);
          setElText('mobLastScan', 'Last: ' + lastTimeStr);
        }

        // Logs (Smart Auto-Scroll with Category Filtering)
        const term = document.getElementById('terminalLogs');
        if (term && data.logs && data.logs.length) {
          let filtered = data.logs;
          if (currentLogFilter === 'applied') {
            filtered = data.logs.filter(l => l.includes('APPLIED to') || l.includes('Applied') || l.includes('[SUCCESS]'));
          } else if (currentLogFilter === 'skip') {
            filtered = data.logs.filter(l => l.includes('[SKIP]'));
          } else if (currentLogFilter === 'error') {
            filtered = data.logs.filter(l => l.includes('[ERROR]') || l.includes('Error') || l.includes('failed'));
          }

          let newHtml = '';
          if (filtered.length === 0) {
            newHtml = '<div class="log-line info" style="color: #94a3b8; font-style: italic; padding: 8px 0;">No ' + currentLogFilter + ' log entries in current 1-hour telemetry window.</div>';
          } else {
            newHtml = filtered.map(line => {
              let cls = 'info';
              if (line.includes('[STANDBY]')) cls = 'standby';
              else if (line.includes('[SKIP]')) cls = 'skip';
              else if (line.includes('APPLIED to')) cls = 'success';
              else if (line.includes('[SUCCESS]') || line.includes('auto-renewed')) cls = 'success';
              else if (line.includes('[ERROR]') || line.includes('Error')) cls = 'error';
              return '<div class="log-line ' + cls + '">' + escapeHtml(line) + '</div>';
            }).join('');
          }

          // Only update DOM if log content actually changed
          if (newHtml !== previousLogsHtml) {
            const isAtBottom = (term.scrollHeight - term.scrollTop - term.clientHeight) < 50 || !previousLogsHtml;
            const prevScrollTop = term.scrollTop;
            const prevScrollHeight = term.scrollHeight;

            term.innerHTML = newHtml;
            previousLogsHtml = newHtml;

            if (isAtBottom) {
              term.scrollTop = term.scrollHeight;
            } else {
              term.scrollTop = prevScrollTop + (term.scrollHeight - prevScrollHeight);
            }
            handleTerminalScroll();
          }
        }

      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    function updateStandbyUI() {
      const badge = document.getElementById("badgeStandby");
      const btn = document.getElementById("btnToggleStandby");
      const mobBadge = document.getElementById("mobBadgeStandby");
      const mobBtn = document.getElementById("mobBtnToggleStandby");

      const istStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      const istDate = new Date(istStr);
      const day = istDate.getDay();
      const hour = istDate.getHours();
      const isNormalWorkingHours = (day >= 1 && day <= 5 && hour >= 8 && hour < 20);

      function applyState(b, bt, badgeCls, badgeTxt, btnCls, btnTxt, btnTitle) {
        if (b) { b.className = badgeCls; b.innerText = badgeTxt; }
        if (bt) { bt.className = btnCls; bt.innerText = btnTxt; bt.title = btnTitle; }
      }

      if (!isAutoStandby) {
        applyState(badge, btn, "standby-badge disabled-247", "⚡ DISABLED (24/7)", "btn-override restore-standby", "🌙 Enable (8AM-8PM)", "Auto-standby is OFF. Automation runs continuously 24/7. Click to re-enable schedule.");
        applyState(mobBadge, mobBtn, "standby-badge disabled-247", "⚡ DISABLED (24/7)", "btn-override restore-standby w-full", "🌙 Enable (8AM-8PM)", "Auto-standby is OFF. Click to re-enable schedule.");
      } else if (!isNormalWorkingHours) {
        const txt = (day === 0 || day === 6) ? "🏖️ Standby (Weekend)" : "🌙 Standby (Sleeping)";
        applyState(badge, btn, "standby-badge standby", txt, "btn-override force-run", "⚡ Disable (Run 24/7)", "Auto-standby is ON (Engine sleeping). Click to disable auto-standby and run right now 24/7.");
        applyState(mobBadge, mobBtn, "standby-badge standby", txt, "btn-override force-run w-full", "⚡ Disable (Run 24/7)", "Engine sleeping. Click to disable auto-standby and run 24/7.");
      } else {
        applyState(badge, btn, "standby-badge active", "🟢 Active (8AM-8PM)", "btn-override force-run", "⚡ Disable (Run 24/7)", "Auto-standby is ON (Operating window). Click to disable auto-standby and run 24/7 non-stop.");
        applyState(mobBadge, mobBtn, "standby-badge active", "🟢 Active (8AM-8PM)", "btn-override force-run w-full", "⚡ Disable (Run 24/7)", "Operating window. Click to disable auto-standby and run 24/7.");
      }
    }

    async function toggleStandbyOverride() {
      const newAutoStandby = !isAutoStandby;
      try {
        const res = await fetch("/api/config/autostandby", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoStandby: newAutoStandby, standbyOverride: !newAutoStandby })
        });
        const data = await res.json();
        if (data.success) {
          isAutoStandby = newAutoStandby;
          isOverrideActive = !newAutoStandby;
          updateStandbyUI();
          showToast(newAutoStandby ? "🌙 Auto-Standby Enabled (Mon-Fri 8AM-8PM IST)" : "⚡ 24/7 Mode Enabled (Runs non-stop)");
        }
      } catch (e) {
        showToast("❌ Failed to update standby schedule: " + e.message);
      }
    }

    async function saveInterval() {
      const val = parseInt(document.getElementById("inputInterval").value, 10);
      if (isNaN(val) || val < 5 || val > 3600) {
        showToast("⚠️ Enter an interval between 5 and 3600 seconds");
        return;
      }
      try {
        const res = await fetch("/api/config/interval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds: val })
        });
        const data = await res.json();
        if (data.success) {
          currentInterval = val;
          setElText('lblActiveInterval', val);
          const mobInput = document.getElementById("mobInputInterval");
          if (mobInput) mobInput.value = val;
          document.querySelectorAll('.preset-btn').forEach(b => {
            b.classList.toggle('active', b.innerText.startsWith(val + 's'));
          });
          showToast("⏱️ Poll interval set to " + val + "s (±3s jitter)");
        }
      } catch (e) {
        showToast("❌ Failed to save interval: " + e.message);
      }
    }

    function openNtfyModal() {
      document.getElementById('chkNtfyEnable').checked = Boolean(currentNtfyConfig && currentNtfyConfig.enabled);
      document.getElementById('inputNtfyTopic').value = (currentNtfyConfig && currentNtfyConfig.topic) || '';
      document.getElementById('ntfyModal').classList.add('open');
    }

    function closeNtfyModal() {
      document.getElementById('ntfyModal').classList.remove('open');
    }

    async function saveNtfyConfig() {
      const enabled = document.getElementById('chkNtfyEnable').checked;
      const topic = document.getElementById('inputNtfyTopic').value.trim();

      if (enabled && !topic) {
        showToast('⚠️ Please enter a private topic name');
        return;
      }

      try {
        const res = await fetch('/api/config/ntfy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, topic })
        });
        const data = await res.json();
        if (data.success) {
          currentNtfyConfig = { enabled, topic };
          closeNtfyModal();
          showToast(enabled ? '📲 ntfy.sh alerts enabled for: ' + topic : '🔕 ntfy.sh alerts disabled');
        } else {
          showToast('❌ Error: ' + (data.error || 'Failed to save ntfy config'));
        }
      } catch (e) {
        showToast('❌ Network error saving ntfy config');
      }
    }

    async function testNtfy() {
      try {
        showToast('📤 Dispatching test alert...');
        const res = await fetch('/api/ntfy/test', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('📲 Alert sent! Check your ntfy phone app.');
        } else {
          showToast('❌ ' + (data.error || 'Failed to send test push'));
        }
      } catch (e) {
        showToast('❌ Network error testing push');
      }
    }

    async function togglePauseResume() {
      const action = (currentStatus === 'online') ? 'pause' : 'resume';
      try {
        const res = await fetch('/api/action/' + action, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast((action === 'pause') ? '⏸️ Cloud Engine Paused' : '▶️ Cloud Engine Resumed');
          fetchData();
        } else {
          showToast('❌ Failed: ' + data.message);
        }
      } catch (e) {
        showToast('❌ Error executing ' + action);
      }
    }

    async function restartEngine() {
      if (!confirm('Are you sure you want to restart the background runner?')) return;
      try {
        const res = await fetch('/api/action/restart', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('🔄 Engine restarted successfully');
          fetchData();
        } else {
          showToast('❌ Failed: ' + data.message);
        }
      } catch (e) {
        showToast('❌ Error restarting engine');
      }
    }

    function openTokenModal() {
      document.getElementById('tokenInput').value = '';
      document.getElementById('tokenModal').classList.add('open');
      document.getElementById('tokenInput').focus();
    }

    function closeTokenModal() {
      document.getElementById('tokenModal').classList.remove('open');
    }

    async function submitNewToken() {
      const token = document.getElementById('tokenInput').value.trim();
      if (!token) {
        showToast('⚠️ Please paste a valid Bearer token');
        return;
      }
      try {
        const res = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (data.success) {
          closeTokenModal();
          showToast('✅ Session Token Updated Successfully');
          fetchData();
        } else {
          showToast('❌ ' + (data.message || 'Invalid Token'));
        }
      } catch (e) {
        showToast('❌ Network error updating token');
      }
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      if (!t) return;
      t.innerText = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 3500);
    }

    function formatUptime(seconds) {
      if (!seconds) return '0s';
      const d = Math.floor(seconds / (3600*24));
      const h = Math.floor(seconds % (3600*24) / 3600);
      const m = Math.floor(seconds % 3600 / 60);
      if (d > 0) return d + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'm';
      return m + 'm';
    }

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Initialize initial state
    const savedSound = localStorage.getItem('soundAlerts');
    if (savedSound === 'false') {
      soundEnabled = false;
      const btn = document.getElementById('btnSound');
      if (btn) { btn.className = 'btn btn-sound'; btn.innerText = '🔕 Sound: OFF'; }
      const mobBtn = document.getElementById('mobBtnSound');
      if (mobBtn) { mobBtn.className = 'btn btn-sound flex-1'; mobBtn.innerText = '🔕 Sound: OFF'; }
    }

    fetchData();
    setInterval(fetchData, 2000);
    setInterval(updateCountdown, 1000);
  </script>
</body>
</html>
`;

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
    const logs = getLogLines(LOG_FILE, 500); // Past ~1 hour of daemon runs
    const storedStats = getStoredStats();
    const stats = storedStats || parseStatsFromLogs(logs);
    const runtimeConfig = getRuntimeConfig();
    const appliedHistory = getAppliedDemandsList();
    const latency = await checkPortalLatency();

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({ pm2, token, hasRefreshToken: hasRefresh, stats, logs, runtimeConfig, appliedHistory, latency }));
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

  // POST /api/config/autostandby or /api/config/standby-override
  if ((pathname === '/api/config/autostandby' || pathname === '/api/config/standby-override') && method === 'POST') {
    const body = await parseJsonBody(req);
    let autoStandby;
    if (body.autoStandby !== undefined) {
      autoStandby = Boolean(body.autoStandby);
    } else if (body.enabled !== undefined) {
      autoStandby = Boolean(body.enabled);
    } else if (body.standbyOverride !== undefined) {
      autoStandby = !Boolean(body.standbyOverride);
    } else {
      autoStandby = true;
    }

    const updated = saveRuntimeConfig({
      autoStandby: autoStandby,
      standbyOverride: !autoStandby
    });

    exec('pm2 restart prod-automator', (err) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({
        success: !err,
        autoStandby: autoStandby,
        standbyOverride: !autoStandby,
        runtimeConfig: updated
      }));
    });
    return;
  }

  // POST /api/config/ntfy (and legacy /api/config/whatsapp)
  if ((pathname === "/api/config/ntfy" || pathname === "/api/config/whatsapp") && method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const topic = (body.topic || body.apiKey || body.phone || "").trim();
      const ntfy = {
        enabled: Boolean(body.enabled),
        topic: topic
      };
      const updated = saveRuntimeConfig({ ntfy, whatsapp: ntfy });
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: true, ntfy: updated.ntfy, whatsapp: updated.whatsapp }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // POST /api/ntfy/test (and legacy /api/whatsapp/test)
  if ((pathname === "/api/ntfy/test" || pathname === "/api/whatsapp/test") && method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const topic = (body.topic || body.apiKey || body.phone || "").trim();
      const result = await sendTestNtfyNotification(topic);
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // POST /api/token/update
  if (pathname === '/api/token/update' && method === 'POST') {
    const body = await parseJsonBody(req);
    let rawToken = (body.token || '').trim();
    if (rawToken.startsWith('Bearer ')) {
      rawToken = rawToken.replace(/^Bearer\s+/i, '').trim();
    }
    if (!rawToken) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Token is required' }));
    }

    const isRefreshToken = rawToken.startsWith('0.A') || rawToken.startsWith('1.A') || !rawToken.startsWith('eyJ');

    if (isRefreshToken) {
      fs.writeFileSync(REFRESH_TOKEN_FILE, rawToken, { mode: 0o600 });
      try {
        const exchange = await refreshAccessToken(rawToken);
        if (exchange && exchange.success) {
          exec('pm2 restart prod-automator', (err) => {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({
              success: !err,
              isRefreshToken: true,
              message: `Refresh token activated! Acquired fresh access token (valid ~${Math.round(exchange.expiresIn / 60)}m). 24/7 autonomous auto-renew is ACTIVE!`,
              token: parseJwt(exchange.accessToken)
            }));
          });
          return;
        }
      } catch (err) {}

      // Fallback if exchange threw
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
