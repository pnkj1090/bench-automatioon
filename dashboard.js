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
  <title>NEXUS • QUANTUM DEMAND AUTOMATOR</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #030712;
      --panel: rgba(8, 14, 28, 0.75);
      --panel-border: rgba(0, 243, 255, 0.18);
      --panel-glow: rgba(0, 243, 255, 0.08);
      --cyan: #00f3ff;
      --cyan-dim: rgba(0, 243, 255, 0.15);
      --green: #00ff9f;
      --green-dim: rgba(0, 255, 159, 0.15);
      --amber: #ffb703;
      --amber-dim: rgba(255, 183, 3, 0.15);
      --purple: #b5179e;
      --purple-neon: #7209b7;
      --danger: #ff0055;
      --danger-dim: rgba(255, 0, 85, 0.15);
      --text: #f0f6fc;
      --text-dim: #7d8590;
      --font-display: 'Chakra Petch', sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
      --font-body: 'Inter', sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      height: 100vh;
      max-height: 100vh;
      overflow: hidden;
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-body);
      line-height: 1.35;
      font-size: 13px;
      background-image: 
        radial-gradient(ellipse 90% 60% at 50% -10%, rgba(0, 243, 255, 0.08) 0%, transparent 70%),
        linear-gradient(rgba(0, 243, 255, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 243, 255, 0.03) 1px, transparent 1px);
      background-size: 100% 100%, 36px 36px, 36px 36px;
    }

    /* Master Single-Screen Frame */
    .viewport {
      height: 100vh;
      max-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 10px 14px;
      gap: 8px;
      box-sizing: border-box;
      position: relative;
    }

    /* Futuristic HUD Panels */
    .hud-panel {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      backdrop-filter: blur(14px);
      position: relative;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), inset 0 0 12px var(--panel-glow);
    }
    .hud-panel::before {
      content: '';
      position: absolute;
      top: -1px; left: 8px; right: 8px; height: 1px;
      background: linear-gradient(90deg, transparent, var(--cyan), transparent);
      opacity: 0.6;
    }

    /* 1. Header Navigation Command Deck */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 14px;
      flex-shrink: 0;
      gap: 12px;
    }

    .brand-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-hex {
      width: 32px; height: 32px;
      background: linear-gradient(135deg, rgba(0, 243, 255, 0.2), rgba(114, 9, 183, 0.4));
      border: 1px solid var(--cyan);
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px;
      color: var(--cyan);
      box-shadow: 0 0 12px rgba(0, 243, 255, 0.4);
      animation: hexGlow 4s infinite alternate;
    }
    @keyframes hexGlow {
      0% { box-shadow: 0 0 8px rgba(0, 243, 255, 0.3); }
      100% { box-shadow: 0 0 16px rgba(0, 243, 255, 0.6); }
    }

    .brand-title {
      display: flex;
      flex-direction: column;
    }
    .brand-title h1 {
      font-family: var(--font-display);
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-title h1 span.sys-code {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--cyan);
      border: 1px solid rgba(0, 243, 255, 0.3);
      padding: 1px 5px;
      border-radius: 3px;
      background: rgba(0, 243, 255, 0.06);
    }
    .brand-title p {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      letter-spacing: 0.02em;
    }

    /* Core Controls Deck */
    .command-deck {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* Standby Switch / Override */
    .standby-hud {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 3px 8px;
    }
    .standby-pill {
      font-family: var(--font-mono);
      font-size: 10.5px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      letter-spacing: 0.03em;
    }
    .standby-pill.standby {
      background: var(--amber-dim);
      color: var(--amber);
      border: 1px solid rgba(255, 183, 3, 0.4);
      box-shadow: 0 0 8px rgba(255, 183, 3, 0.2);
    }
    .standby-pill.override {
      background: rgba(181, 23, 158, 0.25);
      color: #f72585;
      border: 1px solid rgba(247, 37, 133, 0.5);
      box-shadow: 0 0 10px rgba(247, 37, 133, 0.35);
      animation: pulseAlert 2s infinite;
    }
    .standby-pill.active {
      background: var(--green-dim);
      color: var(--green);
      border: 1px solid rgba(0, 255, 159, 0.4);
      box-shadow: 0 0 8px rgba(0, 255, 159, 0.2);
    }
    @keyframes pulseAlert {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.65; }
    }

    .btn-action-override {
      font-family: var(--font-display);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 3px 9px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid transparent;
    }
    .btn-action-override.force-run {
      background: linear-gradient(135deg, #d97706, #b45309);
      color: #fff;
      border-color: #f59e0b;
      box-shadow: 0 0 10px rgba(217, 119, 6, 0.4);
    }
    .btn-action-override.force-run:hover {
      background: #f59e0b;
      box-shadow: 0 0 15px rgba(245, 158, 11, 0.6);
    }
    .btn-action-override.restore-standby {
      background: rgba(114, 9, 183, 0.3);
      border-color: rgba(181, 23, 158, 0.6);
      color: #e0aaff;
    }
    .btn-action-override.restore-standby:hover {
      background: rgba(181, 23, 158, 0.5);
      color: #fff;
      box-shadow: 0 0 12px rgba(181, 23, 158, 0.5);
    }

    /* Editable Interval HUD */
    .interval-hud {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(0, 243, 255, 0.2);
      border-radius: 6px;
      padding: 3px 8px;
    }
    .interval-hud label {
      font-family: var(--font-mono);
      font-size: 10px;
      text-transform: uppercase;
      color: var(--cyan);
      font-weight: 700;
    }
    .interval-input-field {
      width: 42px;
      background: rgba(0, 243, 255, 0.08);
      border: 1px solid rgba(0, 243, 255, 0.3);
      border-radius: 4px;
      color: #fff;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 700;
      text-align: center;
      padding: 2px 3px;
    }
    .interval-input-field:focus {
      outline: none;
      border-color: var(--cyan);
      box-shadow: 0 0 8px rgba(0, 243, 255, 0.5);
    }
    .btn-interval-save {
      background: rgba(0, 243, 255, 0.15);
      border: 1px solid var(--cyan);
      color: var(--cyan);
      font-family: var(--font-display);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      border-radius: 4px;
      padding: 2px 7px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-interval-save:hover {
      background: var(--cyan);
      color: #030712;
      box-shadow: 0 0 10px rgba(0, 243, 255, 0.6);
    }

    /* Header Action Buttons */
    .actions-deck {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .cyber-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.05em;
    }
    .cyber-badge.online {
      background: var(--green-dim);
      border: 1px solid rgba(0, 255, 159, 0.4);
      color: var(--green);
      box-shadow: 0 0 10px rgba(0, 255, 159, 0.2);
    }
    .cyber-badge.stopped {
      background: var(--danger-dim);
      border: 1px solid rgba(255, 0, 85, 0.4);
      color: var(--danger);
      box-shadow: 0 0 10px rgba(255, 0, 85, 0.2);
    }
    .radar-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
    }
    .cyber-badge.online .radar-dot {
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
      animation: radarPulse 1.8s infinite;
    }
    .cyber-badge.stopped .radar-dot { background: var(--danger); }
    @keyframes radarPulse {
      0% { transform: scale(0.9); opacity: 1; }
      50% { transform: scale(1.4); opacity: 0.5; }
      100% { transform: scale(0.9); opacity: 1; }
    }

    .btn-cyber {
      font-family: var(--font-display);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 4px 11px;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid transparent;
    }
    .btn-cyber-pause {
      background: var(--amber-dim);
      border-color: rgba(255, 183, 3, 0.4);
      color: var(--amber);
    }
    .btn-cyber-pause:hover {
      background: rgba(255, 183, 3, 0.3);
      box-shadow: 0 0 10px rgba(255, 183, 3, 0.4);
    }
    .btn-cyber-resume {
      background: var(--green-dim);
      border-color: rgba(0, 255, 159, 0.4);
      color: var(--green);
    }
    .btn-cyber-resume:hover {
      background: rgba(0, 255, 159, 0.3);
      box-shadow: 0 0 10px rgba(0, 255, 159, 0.4);
    }
    .btn-cyber-outline {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.15);
      color: var(--text);
    }
    .btn-cyber-outline:hover {
      border-color: var(--cyan);
      color: var(--cyan);
      box-shadow: 0 0 10px rgba(0, 243, 255, 0.3);
    }
    .btn-cyber-key {
      background: linear-gradient(135deg, rgba(0, 243, 255, 0.2), rgba(37, 99, 235, 0.5));
      border: 1px solid var(--cyan);
      color: #fff;
      box-shadow: 0 0 10px rgba(0, 243, 255, 0.25);
    }
    .btn-cyber-key:hover {
      background: var(--cyan);
      color: #030712;
      box-shadow: 0 0 15px rgba(0, 243, 255, 0.5);
    }

    /* 2. Quantum Telemetry Status Strip */
    .telemetry-strip {
      display: grid;
      grid-template-columns: 1.3fr 0.8fr 1fr 1fr;
      gap: 10px;
      padding: 6px 14px;
      flex-shrink: 0;
      align-items: center;
      font-size: 11px;
    }
    .telemetry-item {
      display: flex;
      align-items: center;
      gap: 7px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hud-tag {
      font-family: var(--font-mono);
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--cyan);
      background: rgba(0, 243, 255, 0.08);
      border: 1px solid rgba(0, 243, 255, 0.2);
      padding: 1px 5px;
      border-radius: 3px;
    }
    .telemetry-val {
      font-weight: 600;
      color: #fff;
      font-family: var(--font-body);
    }

    .neon-pill {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 3px;
      letter-spacing: 0.02em;
    }
    .neon-pill.valid {
      background: var(--green-dim);
      color: var(--green);
      border: 1px solid rgba(0, 255, 159, 0.35);
      box-shadow: 0 0 8px rgba(0, 255, 159, 0.2);
    }
    .neon-pill.warning {
      background: var(--amber-dim);
      color: var(--amber);
      border: 1px solid rgba(255, 183, 3, 0.35);
    }
    .neon-pill.expired {
      background: var(--danger-dim);
      color: var(--danger);
      border: 1px solid rgba(255, 0, 85, 0.35);
    }

    /* 3. Core Metrics Deck */
    .metrics-deck {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      flex-shrink: 0;
    }
    .metric-cell {
      padding: 8px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
      overflow: hidden;
    }
    .metric-cell::after {
      content: '';
      position: absolute;
      top: 0; right: 0; width: 24px; height: 24px;
      background: radial-gradient(circle at top right, rgba(0, 243, 255, 0.15), transparent 70%);
      pointer-events: none;
    }
    .metric-meta {
      display: flex;
      flex-direction: column;
    }
    .metric-title {
      font-family: var(--font-mono);
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--cyan);
    }
    .metric-num {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 700;
      color: #fff;
      line-height: 1.1;
      margin: 2px 0;
      letter-spacing: -0.02em;
    }
    .metric-hint {
      font-size: 9.5px;
      font-family: var(--font-mono);
      color: var(--text-dim);
    }
    .metric-icon-slot {
      font-size: 24px;
      filter: drop-shadow(0 0 8px rgba(0, 243, 255, 0.3));
    }

    /* 4. Cyber Terminal HUD (Fills entire bottom viewport space) */
    .terminal-hud {
      flex: 1;
      min-height: 0; /* Crucial for zero-scroll flex child */
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(0, 243, 255, 0.25);
      background: #02050c;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7), inset 0 0 15px rgba(0, 243, 255, 0.04);
    }

    .terminal-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 12px;
      background: rgba(0, 243, 255, 0.05);
      border-bottom: 1px solid rgba(0, 243, 255, 0.15);
      flex-shrink: 0;
    }
    .terminal-status-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tech-dots {
      display: flex;
      gap: 4px;
    }
    .tech-dot {
      width: 7px; height: 7px; border-radius: 50%;
    }
    .td-red { background: #ff0055; box-shadow: 0 0 5px #ff0055; }
    .td-amber { background: #ffb703; box-shadow: 0 0 5px #ffb703; }
    .td-cyan { background: #00f3ff; box-shadow: 0 0 5px #00f3ff; }

    .terminal-label {
      font-family: var(--font-mono);
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--cyan);
      text-transform: uppercase;
    }
    .terminal-telemetry-meta {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-dim);
    }

    .terminal-screen {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 12px;
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.45;
      background: #010308;
      color: #94a3b8;
    }
    .terminal-screen::-webkit-scrollbar { width: 5px; }
    .terminal-screen::-webkit-scrollbar-track { background: #010308; }
    .terminal-screen::-webkit-scrollbar-thumb { background: rgba(0, 243, 255, 0.25); border-radius: 3px; }
    .terminal-screen::-webkit-scrollbar-thumb:hover { background: var(--cyan); }

    .log-row {
      white-space: pre-wrap;
      word-break: break-all;
      margin-bottom: 2px;
    }
    .log-row.standby { color: #fde047; font-weight: 600; text-shadow: 0 0 4px rgba(253, 224, 71, 0.3); }
    .log-row.info { color: #7dd3fc; }
    .log-row.skip { color: #fbbf24; }
    .log-row.success { color: #4ade80; font-weight: 700; text-shadow: 0 0 6px rgba(74, 222, 128, 0.4); }
    .log-row.error { color: #f87171; font-weight: 700; text-shadow: 0 0 6px rgba(248, 113, 113, 0.4); }

    /* Modal Overlay (Cyber Glass) */
    .modal-veil {
      position: fixed; inset: 0; background: rgba(2, 5, 12, 0.85);
      backdrop-filter: blur(10px);
      display: flex; align-items: center; justify-content: center;
      padding: 20px; z-index: 9999; opacity: 0; pointer-events: none;
      transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .modal-veil.open { opacity: 1; pointer-events: auto; }
    .modal-dialog {
      background: #070d1a;
      border: 1px solid var(--cyan);
      box-shadow: 0 0 35px rgba(0, 243, 255, 0.25), 0 20px 50px rgba(0, 0, 0, 0.9);
      border-radius: 10px;
      width: 100%; max-width: 520px;
      padding: 20px;
      transform: scale(0.96);
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
    }
    .modal-veil.open .modal-dialog { transform: scale(1); }
    .modal-head {
      font-family: var(--font-display);
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .modal-sub {
      font-size: 11.5px;
      color: var(--text-dim);
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .cyber-textarea {
      width: 100%; height: 90px;
      background: #02050c;
      border: 1px solid rgba(0, 243, 255, 0.25);
      border-radius: 6px;
      color: #fff;
      font-family: var(--font-mono);
      font-size: 11px;
      padding: 10px;
      resize: none;
      margin-bottom: 14px;
    }
    .cyber-textarea:focus {
      outline: none;
      border-color: var(--cyan);
      box-shadow: 0 0 10px rgba(0, 243, 255, 0.4);
    }
    .modal-foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    /* Cyber Toast */
    .cyber-toast {
      position: fixed;
      bottom: 20px; right: 20px;
      background: #091322;
      border: 1px solid var(--cyan);
      box-shadow: 0 0 20px rgba(0, 243, 255, 0.35);
      color: #fff;
      padding: 7px 16px;
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 11.5px;
      font-weight: 600;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s ease;
      z-index: 10000;
      pointer-events: none;
    }
    .cyber-toast.show { opacity: 1; transform: translateY(0); }
  </style>
</head>
<body>

  <div class="viewport">
    
    <!-- 1. Header Navigation Command Deck -->
    <header class="hud-panel">
      <div class="brand-group">
        <div class="brand-hex">⚡</div>
        <div class="brand-title">
          <h1>DEMAND AUTOMATOR <span class="sys-code">AWS-EC2 // v4.0</span></h1>
          <p>NAGARRO OPPORTUNISTIC PLACEMENT • QUANTUM ENGINE</p>
        </div>
      </div>

      <!-- Core Controls Deck: Standby & Interval -->
      <div class="command-deck">
        <!-- Standby Status & Override -->
        <div class="standby-hud">
          <span id="badgeStandby" class="standby-pill standby">🌙 STANDBY</span>
          <button id="btnToggleStandby" class="btn-action-override force-run" onclick="toggleStandbyOverride()">
            ⚡ FORCE RUN NOW
          </button>
        </div>

        <!-- Editable Polling Interval -->
        <div class="interval-hud">
          <label>POLL:</label>
          <input type="number" id="inputInterval" class="interval-input-field" min="5" max="3600" value="30" title="Cycle interval in seconds">
          <span style="color: var(--text-dim); font-size: 10px; font-family: var(--font-mono);">SEC</span>
          <button class="btn-interval-save" onclick="saveInterval()" title="Save & apply new interval">SET</button>
        </div>
      </div>

      <!-- Actions Deck -->
      <div class="actions-deck">
        <span id="statusBadge" class="cyber-badge stopped">
          <span class="radar-dot"></span>
          <span id="statusText">CHECKING...</span>
        </span>
        <button id="btnPauseResume" class="btn-cyber btn-cyber-pause" onclick="togglePauseResume()">
          <span id="iconPR">⏸️</span> <span id="textPR">PAUSE</span>
        </button>
        <button class="btn-cyber btn-cyber-outline" onclick="restartEngine()" title="Reboot engine process">
          🔄 REBOOT
        </button>
        <button class="btn-cyber btn-cyber-key" onclick="openTokenModal()">
          🔑 TOKEN
        </button>
      </div>
    </header>

    <!-- 2. Quantum Telemetry Strip -->
    <div class="telemetry-strip hud-panel">
      <div class="telemetry-item">
        <span class="hud-tag">OPERATOR</span>
        <span id="stripCandidate" class="telemetry-val">Pankaj Kumar (pankaj.kumar07@nagarro.com)</span>
      </div>
      <div class="telemetry-item">
        <span class="hud-tag">TTL</span>
        <span id="stripTokenPill" class="neon-pill valid">VALID: --:--</span>
      </div>
      <div class="telemetry-item">
        <span class="hud-tag">CIRCUIT</span>
        <span id="stripAutoRenew" class="telemetry-val" style="color: var(--green);">⚡ Entra ID 45m Auto-Renew Active</span>
      </div>
      <div class="telemetry-item" style="justify-content: flex-end;">
        <span class="hud-tag">NODE</span>
        <span id="stripServer" class="telemetry-val" style="font-family: var(--font-mono); font-size: 11px;">RAM: -- MB | CPU: --% | UPTIME: --</span>
      </div>
    </div>

    <!-- 3. Core Metrics Deck -->
    <div class="metrics-deck">
      <div class="metric-cell hud-panel">
        <div class="metric-meta">
          <span class="metric-title">CYCLES EXECUTED</span>
          <span id="valCycles" class="metric-num">#0</span>
          <span id="valLastScan" class="metric-hint">LAST: NEVER</span>
        </div>
        <div class="metric-icon-slot">🔄</div>
      </div>

      <div class="metric-cell hud-panel">
        <div class="metric-meta">
          <span class="metric-title">DEMANDS EVALUATED</span>
          <span id="valEvaluated" class="metric-num">0</span>
          <span class="metric-hint">LOC: GURUGRAM & WFA</span>
        </div>
        <div class="metric-icon-slot">🔍</div>
      </div>

      <div class="metric-cell hud-panel">
        <div class="metric-meta">
          <span class="metric-title">DISQUALIFIED / SKIPPED</span>
          <span id="valSkipped" class="metric-num">0</span>
          <span class="metric-hint">PYTHON-ONLY / APPLIED</span>
        </div>
        <div class="metric-icon-slot">⏭️</div>
      </div>

      <div class="metric-cell hud-panel">
        <div class="metric-meta">
          <span class="metric-title">AUTO-APPLIED</span>
          <span id="valApplied" class="metric-num" style="color: var(--green); text-shadow: 0 0 12px rgba(0, 255, 159, 0.4);">0</span>
          <span class="metric-hint">FRONTEND & FULL-STACK</span>
        </div>
        <div class="metric-icon-slot">🎯</div>
      </div>
    </div>

    <!-- 4. Cyber Terminal HUD (Fills remaining screen height) -->
    <div class="terminal-hud hud-panel">
      <div class="terminal-bar">
        <div class="terminal-status-left">
          <div class="tech-dots">
            <div class="tech-dot td-red"></div>
            <div class="tech-dot td-amber"></div>
            <div class="tech-dot td-cyan"></div>
          </div>
          <span class="terminal-label">LIVE CLOUD TELEMETRY STREAM</span>
        </div>
        <div id="terminalMeta" class="terminal-telemetry-meta">
          PM2 PID: -- • INTERVAL: 30S • AP-SOUTH-1
        </div>
      </div>
      <div id="terminalLogs" class="terminal-screen">
        <div class="log-row info">Initializing quantum telemetry pipeline...</div>
      </div>
    </div>

  </div>

  <!-- Token Modal Dialog -->
  <div id="tokenModal" class="modal-veil" onclick="if(event.target===this) closeTokenModal()">
    <div class="modal-dialog">
      <h2 class="modal-head">🔑 MICROSOFT ENTRA ID CREDENTIAL</h2>
      <p class="modal-sub">Paste your authentic Microsoft Refresh Token (for 24/7 autonomous cloud rotation) or standard Bearer Token.</p>
      <textarea id="tokenInput" class="cyber-textarea" placeholder="Paste token string here (starts with '0.A...' or 'eyJ...')..."></textarea>
      <div class="modal-foot">
        <button class="btn-cyber btn-cyber-outline" onclick="closeTokenModal()">CANCEL</button>
        <button id="btnSaveToken" class="btn-cyber btn-cyber-key" onclick="submitToken()">SAVE & ENGAGE AUTO-RENEW</button>
      </div>
    </div>
  </div>

  <!-- Toast Notification -->
  <div id="toast" class="cyber-toast">System notification</div>

  <script>
    let currentStatus = 'unknown';
    let tokenExpTimestamp = 0;
    let countdownInterval = null;
    let isOverrideActive = false;
    let currentInterval = 30;

    function showToast(msg, isError = false) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.borderColor = isError ? 'var(--danger)' : 'var(--cyan)';
      t.style.boxShadow = isError ? '0 0 20px rgba(255, 0, 85, 0.4)' : '0 0 20px rgba(0, 243, 255, 0.4)';
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 3000);
    }

    function formatUptime(seconds) {
      if (!seconds) return '0S';
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (d > 0) return d + 'D ' + h + 'H';
      if (h > 0) return h + 'H ' + m + 'M';
      if (m > 0) return m + 'M ' + s + 'S';
      return s + 'S';
    }

    function updateCountdown() {
      const el = document.getElementById('stripTokenPill');
      if (!tokenExpTimestamp) {
        el.innerText = 'NO TOKEN';
        el.className = 'neon-pill expired';
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const diff = tokenExpTimestamp - now;
      if (diff <= 0) {
        el.innerText = 'EXPIRED (ROTATING...)';
        el.className = 'neon-pill expired';
      } else {
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        el.innerText = 'VALID: ' + m + 'M ' + (s < 10 ? '0' : '') + s + 'S';
        if (diff > 900) el.className = 'neon-pill valid';
        else if (diff > 300) el.className = 'neon-pill warning';
        else el.className = 'neon-pill expired';
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
            badge.className = 'cyber-badge online';
            text.innerText = 'ONLINE';
            btnPR.className = 'btn-cyber btn-cyber-pause';
            iconPR.innerText = '⏸️';
            textPR.innerText = 'PAUSE';
          } else {
            badge.className = 'cyber-badge stopped';
            text.innerText = 'PAUSED';
            btnPR.className = 'btn-cyber btn-cyber-resume';
            iconPR.innerText = '▶️';
            textPR.innerText = 'RESUME';
          }

          document.getElementById('stripServer').innerText = 'RAM: ' + data.pm2.memoryMb + ' MB | CPU: ' + data.pm2.cpu + '% | UPTIME: ' + formatUptime(data.pm2.uptime);
          document.getElementById('terminalMeta').innerText = 'PM2: ' + currentStatus.toUpperCase() + ' (RAM: ' + data.pm2.memoryMb + 'MB) • INTERVAL: ' + (data.runtimeConfig?.pollIntervalSeconds || 30) + 'S';
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
          document.getElementById('stripCandidate').innerText = data.token.name + ' (' + data.token.email + ')';
          updateCountdown();
        }

        // Auto Renew
        if (data.hasRefreshToken) {
          document.getElementById('stripAutoRenew').innerHTML = '<span style="color: var(--green);">⚡ Entra ID 45m Auto-Renew Active</span>';
        } else {
          document.getElementById('stripAutoRenew').innerHTML = '<span style="color: var(--amber);">⚠️ Manual Token (Rotation Inactive)</span>';
        }

        // Stats
        if (data.stats) {
          document.getElementById('valCycles').innerText = '#' + data.stats.cycles;
          document.getElementById('valEvaluated').innerText = (data.stats.cycles * 2);
          document.getElementById('valSkipped').innerText = (data.stats.skippedAlreadyApplied + data.stats.skippedPythonOnly);
          document.getElementById('valApplied').innerText = data.stats.applied;
          document.getElementById('valLastScan').innerText = 'LAST: ' + data.stats.lastScan;
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
            return '<div class="log-row ' + cls + '">' + escapeHtml(line) + '</div>';
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

      const istStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      const istDate = new Date(istStr);
      const day = istDate.getDay();
      const hour = istDate.getHours();
      const isNormalWorkingHours = (day >= 1 && day <= 5 && hour >= 8 && hour < 20);

      if (isOverrideActive) {
        badge.className = 'standby-pill override';
        badge.innerText = '⚡ OVERRIDE ACTIVE';
        btn.className = 'btn-action-override restore-standby';
        btn.innerText = '🌙 RE-ENABLE STANDBY';
        btn.title = 'Return to scheduled standby (Mon-Fri 8AM-8PM IST)';
      } else if (!isNormalWorkingHours) {
        badge.className = 'standby-pill standby';
        badge.innerText = (day === 0 || day === 6) ? '🏖️ WEEKEND STANDBY' : '🌙 NIGHT STANDBY';
        btn.className = 'btn-action-override force-run';
        btn.innerText = '⚡ FORCE RUN NOW';
        btn.title = 'Bypass schedule and run automation immediately right now';
      } else {
        badge.className = 'standby-pill active';
        badge.innerText = '🟢 ACTIVE WINDOW';
        btn.className = 'btn-action-override restore-standby';
        btn.innerText = '🌙 FORCE STANDBY';
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
          showToast('⏱️ Poll interval calibrated to ' + sec + 's! Engine rebooted.');
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
        showToast(action === 'pause' ? '⏸️ Automation paused.' : '▶️ Automation engaged!');
        fetchData();
      } catch (e) {
        showToast('Action failed: ' + e.message, true);
      }
    }

    async function restartEngine() {
      try {
        await fetch('/api/engine/restart', { method: 'POST' });
        showToast('🔄 Quantum engine rebooted!');
        fetchData();
      } catch (e) {
        showToast('Reboot failed: ' + e.message, true);
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
      btn.innerText = 'CALIBRATING ON AWS...';

      try {
        const res = await fetch('/api/token/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || '🎉 Autonomous auto-renewal engaged on AWS!');
          closeTokenModal();
          fetchData();
        } else {
          showToast('Failed: ' + (data.error || 'Invalid token'), true);
        }
      } catch (e) {
        showToast('Error: ' + e.message, true);
      } finally {
        btn.disabled = false;
        btn.innerText = 'SAVE & ENGAGE AUTO-RENEW';
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
