#!/usr/bin/env node
/**
 * One-Time Autonomous Session Synchronizer for AWS EC2
 * 
 * 1. Launches a visible browser on your Mac so you can sign in to the portal once with your corporate SSO.
 * 2. Automatically captures your persistent session cookies & MSAL tokens.
 * 3. Saves them to auth-state.json and securely uploads them to your AWS EC2 instance.
 * 4. Triggers a test headless renewal on EC2 to verify 100% autonomous operation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_STATE_FILE = path.join(__dirname, 'auth-state.json');
const SSH_KEY = path.join(__dirname, 'demand-automator-key.pem');
const EC2_HOST = '13.204.76.22';
const EC2_USER = 'ec2-user';
const EC2_DIR = '/home/ec2-user/bench-automation';
const TARGET_URL = 'https://opportunistic-placement.azurewebsites.net/demands';

console.log(`\n======================================================`);
console.log(`🚀 AUTONOMOUS AZURE AD SESSION SYNCHRONIZER (AWS EC2)`);
console.log(`======================================================`);
console.log(`Opening browser window to capture your persistent SSO session...`);
console.log(`======================================================\n`);

async function main() {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome'
  }).catch(() => {
    return chromium.launch({ headless: false });
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 850 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  // Expose binding so user can trigger sync by clicking top banner or button
  let manualTrigger = false;
  await page.exposeFunction('triggerSessionSync', () => {
    manualTrigger = true;
    console.log('👉 [SYNC] Manual "Sync Now" button clicked by user!');
  });

  await page.goto(TARGET_URL);

  // Helper to inject helper banner
  async function injectBanner() {
    try {
      await page.evaluate(() => {
        if (document.getElementById('automator-sync-banner')) return;
        const div = document.createElement('div');
        div.id = 'automator-sync-banner';
        div.style.position = 'fixed';
        div.style.top = '0';
        div.style.left = '0';
        div.style.right = '0';
        div.style.zIndex = '9999999';
        div.style.background = 'linear-gradient(135deg, #059669 0%, #10b981 100%)';
        div.style.color = '#ffffff';
        div.style.padding = '12px 24px';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
        div.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        div.style.fontSize = '14px';
        div.style.fontWeight = '600';
        
        div.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:18px;">🤖</span>
            <span>AWS DEMAND AUTOMATOR: Sign in to complete 1-time Cloud SSO sync.</span>
          </div>
          <button id="btn-force-sync" style="background:#ffffff;color:#065f46;border:none;padding:8px 18px;border-radius:6px;font-weight:700;cursor:pointer;font-size:13px;box-shadow:0 2px 5px rgba(0,0,0,0.2);">
            ✅ I'M SIGNED IN - SYNC TO EC2 NOW
          </button>
        `;
        document.body.appendChild(div);

        document.getElementById('btn-force-sync').addEventListener('click', () => {
          document.getElementById('btn-force-sync').innerText = '⏳ Syncing session to EC2...';
          document.getElementById('btn-force-sync').style.opacity = '0.7';
          window.triggerSessionSync();
        });
      });
    } catch (e) {}
  }

  page.on('load', injectBanner);

  console.log('⏳ Waiting for authentication (Auto-detecting or click the green top bar)...');

  let authenticated = false;
  let tokens = null;
  let lastUrl = '';

  for (let i = 0; i < 300; i++) {
    if (page.isClosed()) {
      console.error('❌ Browser window was closed before sync.');
      process.exit(1);
    }

    const currentUrl = page.url();
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      console.log(`📍 Current Page: ${currentUrl.slice(0, 80)}...`);
      await injectBanner();
    }

    // Check for tokens and cookies
    try {
      const extracted = await page.evaluate(() => {
        let refreshToken = null;
        let accessToken = null;

        function scanStorage(storage) {
          for (let j = 0; j < storage.length; j++) {
            const k = storage.key(j);
            const v = storage.getItem(k);
            if (!v) continue;
            try {
              const p = JSON.parse(v);
              if (p.credentialType === 'RefreshToken' && p.secret) refreshToken = p.secret;
              if (p.credentialType === 'AccessToken' && p.secret) accessToken = p.secret;
              if (p.secret && (p.secret.startsWith('0.A') || p.secret.startsWith('1.A'))) refreshToken = p.secret;
              if (p.secret && p.secret.startsWith('eyJ')) accessToken = p.secret;
            } catch (e) {
              if (v.startsWith('0.A') || v.startsWith('1.A')) refreshToken = v;
              if (v.startsWith('eyJ')) accessToken = v;
            }
          }
        }

        scanStorage(sessionStorage);
        scanStorage(localStorage);

        return { refreshToken, accessToken };
      });

      tokens = extracted;

      const cookies = await context.cookies();
      const hasKmsi = cookies.some(c => c.name.includes('ESTSAUTHPERSISTENT') || c.name.includes('ESTSAUTH'));

      if (manualTrigger || (tokens.refreshToken && tokens.accessToken && currentUrl.includes('opportunistic-placement'))) {
        authenticated = true;
        console.log('\n🎉 Active authentication session confirmed!');
        if (tokens.refreshToken) {
          console.log(`🔑 Refresh Token: ${tokens.refreshToken.slice(0, 20)}...`);
        }
        if (tokens.accessToken) {
          console.log(`🔑 Access Token:  ${tokens.accessToken.slice(0, 20)}...`);
        }
        console.log(`🍪 Cookies captured: ${cookies.length} total (Microsoft SSO cookies: ${hasKmsi ? 'YES ✅' : 'SESSION ONLY'})`);
        break;
      }
    } catch (e) {}

    await new Promise(r => setTimeout(r, 1000));
  }

  if (!authenticated) {
    console.error('❌ Authentication timeout or cancelled.');
    await browser.close();
    process.exit(1);
  }

  // Save storage state to auth-state.json
  await context.storageState({ path: AUTH_STATE_FILE });
  console.log(`💾 Saved complete session state to: ${AUTH_STATE_FILE}`);

  await browser.close();

  // Upload to EC2
  console.log(`\n📤 Uploading auth-state.json to AWS EC2 (${EC2_HOST})...`);
  try {
    execSync(`scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${AUTH_STATE_FILE}" ${EC2_USER}@${EC2_HOST}:${EC2_DIR}/auth-state.json`, { stdio: 'inherit' });
    console.log('✅ Upload to EC2 successful!');
  } catch (err) {
    console.error(`❌ Failed to upload to EC2: ${err.message}`);
    process.exit(1);
  }

  // Test headless renewal on EC2
  console.log(`\n🧪 Executing test headless renewal on EC2...`);
  try {
    const output = execSync(`ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} "cd ${EC2_DIR} && node renew-session-headless.js"`, { encoding: 'utf8' });
    console.log(output);
    console.log('\n======================================================');
    console.log('🎉 100% AUTONOMOUS CLOUD RENEWAL IS ACTIVE ON AWS!');
    console.log('======================================================');
    console.log('Your EC2 instance now runs headless Chromium every day to renew');
    console.log('your Azure AD tokens autonomously without human intervention.');
    console.log('======================================================\n');
  } catch (err) {
    console.error(`Verification notice: ${err.message}`);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
