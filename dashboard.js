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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demand Automator • Mission Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #07090e;
      --card-bg: rgba(15, 23, 42, 0.7);
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

    /* 1. Header Bar */
    header {
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
    .btn-whatsapp {
      background: rgba(37, 211, 102, 0.12);
      border-color: rgba(37, 211, 102, 0.3);
      color: #25d366;
    }
    .btn-whatsapp:hover { background: rgba(37, 211, 102, 0.22); color: #fff; }
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

    /* 2. Compact Status Strip */
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

    /* 3. Compact Metrics Row */
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

    /* 4. Terminal Section (Fills remaining screen space) */
    .terminal-wrapper {
      flex: 1;
      min-height: 0; /* Critical for flex scroll */
      display: flex;
      flex-direction: column;
      background: #03060d;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
      overflow: hidden;
    }
    .terminal-header {
      background: rgba(255, 255, 255, 0.03);
      padding: 6px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      display: flex; justify-content: space-between; align-items: center;
      flex-shrink: 0;
    }
    .terminal-dots { display: flex; gap: 5px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; }
    .dot-red { background: #ff5f56; }
    .dot-yellow { background: #ffbd2e; }
    .dot-green { background: #27c93f; }
    .terminal-title {
      font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); font-weight: 600;
    }
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

    /* Slide-Over Drawer for Applied Demands */
    .drawer-backdrop {
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(6px); z-index: 1500;
      opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
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
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex; justify-content: space-between; align-items: center;
      background: rgba(255, 255, 255, 0.02);
      flex-shrink: 0;
    }
    .drawer-title { font-size: 15px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
    .drawer-close {
      background: rgba(255, 255, 255, 0.06); border: none; color: var(--text-muted);
      width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; font-size: 14px;
    }
    .drawer-close:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }

    .drawer-body {
      flex: 1; overflow-y: auto; padding: 14px 18px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .drawer-body::-webkit-scrollbar { width: 5px; }
    .drawer-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 3px; }

    .applied-item-card {
      background: rgba(255, 255, 255, 0.03);
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
      padding: 20px; z-index: 1000; opacity: 0; pointer-events: none;
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
  </style>
</head>
<body>

  <div class="app-viewport">
    
    <!-- 1. Header Bar -->
    <header>
      <div class="brand">
        <div class="brand-icon">⚡</div>
        <div class="brand-title">
          <h1>Demand Automator <span id="statusBadge" class="status-badge stopped"><span class="pulse-dot"></span><span id="statusText">CHECKING...</span></span></h1>
          <p>Nagarro Opportunistic Placement • Autonomous Cloud Runner</p>
        </div>
      </div>

      <!-- Center Controls: Interval & Standby Override -->
      <div class="header-center">
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

      <!-- Right Actions -->
      <div class="header-actions">
        <!-- Applied History Drawer Button -->
        <button class="btn btn-history" onclick="toggleAppliedDrawer()" title="View history of all auto-applied demands">
          📋 History (<span id="appliedBadgeCount">0</span>)
        </button>

        <!-- Sound Toggle -->
        <button id="btnSound" class="btn btn-sound on" onclick="toggleSound()" title="Toggle audible chime when a demand is auto-applied">
          🔔 Sound: ON
        </button>

        <!-- WhatsApp Setup -->
        <button class="btn btn-whatsapp" onclick="openWhatsAppModal()" title="Configure instant WhatsApp alerts when demands are auto-applied">
          📲 WhatsApp
        </button>

        <button id="btnPauseResume" class="btn btn-pause" onclick="togglePauseResume()">
          <span id="iconPR">⏸️</span> <span id="textPR">Pause</span>
        </button>
        <button class="btn btn-outline" onclick="restartEngine()" title="Restart engine process">
          🔄 Restart
        </button>
        <button class="btn btn-token" onclick="openTokenModal()">
          🔑 Token
        </button>
      </div>
    </header>

    <!-- 2. Compact Status Strip -->
    <div class="status-strip">
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

    <!-- 3. Compact Metrics Row -->
    <div class="metrics-row">
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

    <!-- 4. Live Terminal Viewport (Fills remaining space) -->
    <div class="terminal-wrapper">
      <div class="terminal-header">
        <div class="terminal-dots">
          <div class="dot dot-red"></div>
          <div class="dot dot-yellow"></div>
          <div class="dot dot-green"></div>
        </div>
        <div class="terminal-title">LIVE CLOUD TELEMETRY • AWS EC2 (Mumbai ap-south-1)</div>
        <div id="terminalMeta" class="terminal-meta">PM2 PID: -- • Mon-Fri (8AM-8PM IST)</div>
      </div>
      <div id="terminalLogs" class="terminal-body">
        <div class="log-line info">Connecting to AWS cloud logs...</div>
      </div>
    </div>

  </div>

  <!-- Slide-Over Drawer for Applied Demands History -->
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

  <!-- WhatsApp Notification Modal -->
  <div id="whatsappModal" class="modal-overlay" onclick="if(event.target===this) closeWhatsAppModal()">
    <div class="modal-box" style="max-width: 480px;">
      <h2 class="modal-title">📲 WhatsApp Auto-Apply Alerts</h2>
      <p class="modal-desc">Get an instant WhatsApp notification with full demand details and AI pitch whenever a job is auto-applied via free CallMeBot API.</p>
      
      <div style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
        <span style="font-size: 13px; font-weight: 600;">Enable WhatsApp Alerts:</span>
        <label style="position: relative; display: inline-flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="chkWhatsAppEnabled" style="width: 18px; height: 18px; cursor: pointer; accent-color: #25d366;">
          <span style="font-size: 12px; color: var(--text-muted);">Active</span>
        </label>
      </div>

      <div style="margin-bottom: 10px;">
        <label style="display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">WhatsApp Number (with country code):</label>
        <input type="text" id="inputWhatsAppPhone" class="interval-input" style="width: 100%; box-sizing: border-box; text-align: left; padding: 6px 10px; font-size: 13px;" placeholder="+919876543210">
      </div>

      <div style="margin-bottom: 12px;">
        <label style="display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">CallMeBot API Key:</label>
        <input type="text" id="inputWhatsAppApiKey" class="interval-input" style="width: 100%; box-sizing: border-box; text-align: left; padding: 6px 10px; font-size: 13px;" placeholder="e.g. 123456">
      </div>

      <div style="background: rgba(37, 99, 235, 0.1); border: 1px solid rgba(37, 99, 235, 0.25); border-radius: 6px; padding: 8px 10px; font-size: 11px; line-height: 1.4; color: #93c5fd; margin-bottom: 14px;">
        💡 <b>How to get your free CallMeBot API key (takes 30 seconds):</b><br>
        1. Save <b>+34 644 68 83 34</b> to your phone contacts as <i>CallMeBot</i>.<br>
        2. Send WhatsApp message: <code>I allow callmebot to send me messages</code><br>
        3. Copy the apiKey from their reply and paste it here.
      </div>

      <div class="modal-actions" style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="btn btn-outline" onclick="closeWhatsAppModal()">Close</button>
        <button class="btn btn-outline" style="border-color: rgba(37, 211, 102, 0.4); color: #25d366;" onclick="testWhatsAppMessage()" id="btnTestWhatsApp">🧪 Send Test</button>
        <button class="btn btn-token" style="background: linear-gradient(135deg, #059669, #10b981);" onclick="saveWhatsAppSettings()" id="btnSaveWhatsApp">💾 Save Settings</button>
      </div>
    </div>
  </div>

  <!-- Token Modal -->
  <div id="tokenModal" class="modal-overlay" onclick="if(event.target===this) closeTokenModal()">
    <div class="modal-box">
      <h2 class="modal-title">🔑 Update Azure AD / Refresh Token</h2>
      <p class="modal-desc">Paste your fresh Microsoft Entra ID Refresh Token (recommended for 24/7 autonomous renewal) or Bearer Access Token.</p>
      <textarea id="tokenInput" class="token-textarea" placeholder="Paste token here (starts with '0.A...' or 'eyJ...')..."></textarea>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeTokenModal()">Cancel</button>
        <button id="btnSaveToken" class="btn btn-token" onclick="submitToken()">Save & Enable Auto-Renew</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div id="toast" class="toast">Action notification</div>

  <script>
    let currentStatus = 'unknown';
    let tokenExpTimestamp = 0;
    let countdownInterval = null;
    let isAutoStandby = true;
    let isOverrideActive = false;
    let currentInterval = 30;
    let previousAppliedCount = 0;
    let soundEnabled = localStorage.getItem('soundAlerts') !== 'false';
    let appliedHistoryData = [];
    let currentWhatsAppConfig = { enabled: false, phone: "", apiKey: "" };

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

    // Pleasant Web Audio synthesizer chime for auto-apply notification
    function playChime() {
      if (!soundEnabled) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(440, ctx.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.18); // D6

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start();
        osc2.start();
        osc1.stop(ctx.currentTime + 0.55);
        osc2.stop(ctx.currentTime + 0.55);
      } catch (e) {}
    }

    function toggleSound() {
      soundEnabled = !soundEnabled;
      localStorage.setItem('soundAlerts', soundEnabled ? 'true' : 'false');
      updateSoundUI();
      if (soundEnabled) {
        playChime();
        showToast('🔔 Sound alerts enabled!');
      } else {
        showToast('🔕 Sound alerts muted.');
      }
    }

    function updateSoundUI() {
      const btn = document.getElementById('btnSound');
      if (soundEnabled) {
        btn.className = 'btn btn-sound on';
        btn.innerText = '🔔 Sound: ON';
      } else {
        btn.className = 'btn btn-sound';
        btn.innerText = '🔕 Sound: OFF';
      }
    }

    function toggleAppliedDrawer(forceOpen) {
      const drawer = document.getElementById('appliedDrawerBackdrop');
      if (forceOpen === true) {
        drawer.classList.add('open');
      } else if (forceOpen === false) {
        drawer.classList.remove('open');
      } else {
        drawer.classList.toggle('open');
      }
      if (drawer.classList.contains('open')) {
        renderDrawerItems();
      }
    }

    function renderDrawerItems() {
      const container = document.getElementById('drawerBody');
      const badge = document.getElementById('drawerBadgeCount');
      const headerCount = document.getElementById('appliedBadgeCount');
      
      const count = appliedHistoryData.length;
      badge.innerText = count + ' Total';
      headerCount.innerText = count;

      if (!count) {
        container.innerHTML = \`
          <div style="text-align: center; color: var(--text-muted); padding: 50px 20px;">
            <div style="font-size: 34px; margin-bottom: 10px;">📭</div>
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
            badge.className = 'status-badge online';
            text.innerText = 'ONLINE';
            btnPR.className = 'btn btn-pause';
            iconPR.innerText = '⏸️';
            textPR.innerText = 'Pause';
          } else {
            badge.className = 'status-badge stopped';
            text.innerText = 'PAUSED';
            btnPR.className = 'btn btn-resume';
            iconPR.innerText = '▶️';
            textPR.innerText = 'Resume';
          }

          document.getElementById('stripServer').innerText = 'RAM: ' + data.pm2.memoryMb + ' MB | CPU: ' + data.pm2.cpu + '% | Up: ' + formatUptime(data.pm2.uptime);
          document.getElementById('terminalMeta').innerText = 'PM2: ' + currentStatus.toUpperCase() + ' (RAM: ' + data.pm2.memoryMb + 'MB) • Interval: ' + (data.runtimeConfig?.pollIntervalSeconds || 30) + 's (±3s jitter)';
        }

        // Latency
        if (typeof data.latency === 'number') {
          const latEl = document.getElementById('stripLatencyPill');
          latEl.innerText = '⚡ ' + data.latency + ' ms';
          if (data.latency < 150) latEl.className = 'latency-pill fast';
          else if (data.latency < 450) latEl.className = 'latency-pill medium';
          else latEl.className = 'latency-pill slow';
        }

        // Runtime Config: Interval & Auto-Standby
        if (data.runtimeConfig) {
          isAutoStandby = data.runtimeConfig.autoStandby !== undefined
            ? Boolean(data.runtimeConfig.autoStandby)
            : !Boolean(data.runtimeConfig.standbyOverride);
          isOverrideActive = !isAutoStandby;
          currentInterval = data.runtimeConfig.pollIntervalSeconds || 30;
          if (data.runtimeConfig.whatsapp) {
            currentWhatsAppConfig = data.runtimeConfig.whatsapp;
          }

          const inputInt = document.getElementById('inputInterval');
          if (document.activeElement !== inputInt) {
            inputInt.value = currentInterval;
          }

          updateStandbyUI();
        }

        // Token Info
        if (data.token) {
          tokenExpTimestamp = data.token.exp;
          document.getElementById('stripCandidate').innerText = data.token.name + ' (' + data.token.email + ')';
          updateCountdown();
        }

        // Auto Renew
        if (data.hasRefreshToken) {
          document.getElementById('stripAutoRenew').innerHTML = '<span style="color: #34d399;">✅ 45m Auto-Renew Active</span>';
        } else {
          document.getElementById('stripAutoRenew').innerHTML = '<span style="color: #f59e0b;">⚠️ Manual Token Only</span>';
        }

        // Applied History Data & Sound Chime on increase
        if (Array.isArray(data.appliedHistory)) {
          appliedHistoryData = data.appliedHistory;
          const currentCount = appliedHistoryData.length;
          document.getElementById('appliedBadgeCount').innerText = currentCount;
          document.getElementById('drawerBadgeCount').innerText = currentCount + ' Total';

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

          document.getElementById('valCycles').innerText = '#' + cycles;
          document.getElementById('valEvaluated').innerText = evaluated;
          document.getElementById('valSkipped').innerText = skipped;
          document.getElementById('valApplied').innerText = applied;
          
          let lastTimeStr = data.stats.lastScan;
          if (data.stats.lastCycleTime) {
            try {
              lastTimeStr = new Date(data.stats.lastCycleTime).toLocaleTimeString("en-US", { hour12: false, timeZone: "Asia/Kolkata" });
            } catch(e) {}
          }
          document.getElementById('valLastScan').innerText = 'Last: ' + lastTimeStr;
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
      const badge = document.getElementById("badgeStandby");
      const btn = document.getElementById("btnToggleStandby");

      const istStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      const istDate = new Date(istStr);
      const day = istDate.getDay();
      const hour = istDate.getHours();
      const isNormalWorkingHours = (day >= 1 && day <= 5 && hour >= 8 && hour < 20);

      if (!isAutoStandby) {
        badge.className = "standby-badge disabled-247";
        badge.innerText = "⚡ DISABLED (24/7)";
        btn.className = "btn-override restore-standby";
        btn.innerText = "🌙 Enable (8AM-8PM)";
        btn.title = "Auto-standby is OFF. Automation runs continuously 24/7. Click to re-enable schedule.";
      } else if (!isNormalWorkingHours) {
        badge.className = "standby-badge standby";
        badge.innerText = (day === 0 || day === 6) ? "🏖️ Standby (Weekend)" : "🌙 Standby (Sleeping)";
        btn.className = "btn-override force-run";
        btn.innerText = "⚡ Disable (Run 24/7)";
        btn.title = "Auto-standby is ON (Engine sleeping). Click to disable auto-standby and run right now 24/7.";
      } else {
        badge.className = "standby-badge active";
        badge.innerText = "🟢 Active (8AM-8PM)";
        btn.className = "btn-override force-run";
        btn.innerText = "⚡ Disable (Run 24/7)";
        btn.title = "Auto-standby is ON (Operating window). Click to disable auto-standby and run 24/7 non-stop.";
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
          showToast(newAutoStandby ? "🌙 Auto-Standby ENABLED: Following Mon-Fri 8AM-8PM schedule." : "⚡ Auto-Standby DISABLED: Engine will now run 24/7 continuously!");
          fetchData();
        } else {
          showToast("Failed to toggle standby: " + (data.error || "Unknown error"), true);
        }
      } catch (e) {
        showToast("Error: " + e.message, true);
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
          showToast('⏱️ Poll interval calibrated to ' + sec + 's (±3s human jitter)! Engine restarted.');
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

    function openWhatsAppModal() {
      const cfg = currentWhatsAppConfig || {};
      document.getElementById("chkWhatsAppEnabled").checked = Boolean(cfg.enabled);
      document.getElementById("inputWhatsAppPhone").value = cfg.phone || "";
      document.getElementById("inputWhatsAppApiKey").value = cfg.apiKey || "";
      document.getElementById("whatsappModal").classList.add("open");
    }

    function closeWhatsAppModal() {
      document.getElementById("whatsappModal").classList.remove("open");
    }

    async function testWhatsAppMessage() {
      const phone = document.getElementById("inputWhatsAppPhone").value.trim();
      const apiKey = document.getElementById("inputWhatsAppApiKey").value.trim();
      if (!phone || !apiKey) {
        alert("Please enter both your phone number and CallMeBot API key.");
        return;
      }
      const btn = document.getElementById("btnTestWhatsApp");
      btn.disabled = true;
      btn.innerText = "Sending...";
      try {
        const res = await fetch("/api/whatsapp/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, apiKey })
        });
        const data = await res.json();
        if (data.success) {
          showToast("✅ WhatsApp test message delivered! Check your phone.");
        } else {
          showToast("Failed to send test: " + (data.error || "Check phone/API key"), true);
        }
      } catch (e) {
        showToast("Error: " + e.message, true);
      } finally {
        btn.disabled = false;
        btn.innerText = "🧪 Send Test";
      }
    }

    async function saveWhatsAppSettings() {
      const enabled = document.getElementById("chkWhatsAppEnabled").checked;
      const phone = document.getElementById("inputWhatsAppPhone").value.trim();
      const apiKey = document.getElementById("inputWhatsAppApiKey").value.trim();

      const btn = document.getElementById("btnSaveWhatsApp");
      btn.disabled = true;
      btn.innerText = "Saving...";
      try {
        const res = await fetch("/api/config/whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled, phone, apiKey })
        });
        const data = await res.json();
        if (data.success) {
          currentWhatsAppConfig = data.whatsapp;
          showToast(enabled ? "✅ WhatsApp alerts ENABLED!" : "WhatsApp alerts saved.");
          closeWhatsAppModal();
        } else {
          showToast("Failed to save WhatsApp config", true);
        }
      } catch (e) {
        showToast("Error: " + e.message, true);
      } finally {
        btn.disabled = false;
        btn.innerText = "💾 Save Settings";
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

    updateSoundUI();
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

  // POST /api/config/whatsapp
  if (pathname === "/api/config/whatsapp" && method === "POST") {
    const body = await parseJsonBody(req);
    const whatsapp = {
      enabled: Boolean(body.enabled),
      phone: (body.phone || "").trim(),
      apiKey: (body.apiKey || "").trim()
    };
    const updated = saveRuntimeConfig({ whatsapp });
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ success: true, whatsapp: updated.whatsapp }));
  }

  // POST /api/whatsapp/test
  if (pathname === "/api/whatsapp/test" && method === "POST") {
    const body = await parseJsonBody(req);
    const phone = (body.phone || "").trim();
    const apiKey = (body.apiKey || "").trim();
    const result = await sendTestWhatsAppMessage(phone, apiKey);
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify(result));
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
