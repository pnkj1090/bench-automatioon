#!/usr/bin/env node
// Standalone CLI / Daemon Automation Runner

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DemandAutomationEngine } from './engine.js';
import { CONFIG } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_FILE = path.join(__dirname, 'token.txt');

// Parse command line arguments
const args = process.argv.slice(2);
let target = 'mock';
let authToken = process.env.AUTH_TOKEN || null;

for (const arg of args) {
  if (arg.startsWith('--target=')) {
    target = arg.split('=')[1];
  } else if (arg.startsWith('--token=')) {
    authToken = arg.split('=')[1];
  }
}

// Prioritize token.txt if available
if (fs.existsSync(TOKEN_FILE)) {
  try {
    const fileToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (fileToken) authToken = fileToken;
  } catch (e) {}
}

const baseUrl = CONFIG.environments[target]?.baseUrl || 'http://localhost:3000';

console.log(`\n======================================================`);
console.log(`🤖 OPPORTUNISTIC PLACEMENT - AUTONOMOUS DAEMON WORKER`);
console.log(`======================================================`);
console.log(`Target:      ${target.toUpperCase()} (${baseUrl})`);
console.log(`Interval:    ${CONFIG.pollIntervalMs / 1000} seconds`);
console.log(`Location:    ${CONFIG.filters.location.join(', ')}`);
console.log(`Genus Roles: ${CONFIG.filters.genus.length} roles filtered`);
console.log(`Rules:       ✅ Frontend only -> APPLY`);
console.log(`             ✅ Frontend + Python -> APPLY`);
console.log(`             🚫 Python ONLY -> DO NOT APPLY`);
console.log(`======================================================\n`);

const worker = new DemandAutomationEngine({
  target,
  baseUrl,
  authToken,
  intervalMs: CONFIG.pollIntervalMs,
  onLog: (entry) => {
    // Already logged to stdout in engine
  }
});

worker.start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping worker daemon...');
  worker.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nTerminating worker daemon...');
  worker.stop();
  process.exit(0);
});
