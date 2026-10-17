import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_STATE_FILE = path.join(__dirname, 'auth-state.json');
const TOKEN_FILE = path.join(__dirname, 'token.txt');
const REFRESH_TOKEN_FILE = path.join(__dirname, 'refresh-token.txt');
const TARGET_URL = 'https://opportunistic-placement.azurewebsites.net/demands';

export async function runHeadlessRenewal() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🔄 [HEADLESS RENEWER] Starting autonomous session token renewal...`);

  if (!fs.existsSync(AUTH_STATE_FILE)) {
    console.error(`[${timestamp}] ❌ [HEADLESS RENEWER] auth-state.json not found at ${AUTH_STATE_FILE}`);
    return { success: false, error: 'auth-state.json missing. Initial 1-time session capture required.' };
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--disable-breakpad',
        '--disable-crash-reporter'
      ]
    });

    const context = await browser.newContext({
      storageState: AUTH_STATE_FILE,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    console.log(`[${timestamp}] 🌐 [HEADLESS RENEWER] Navigating to ${TARGET_URL}...`);

    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 35000 });

    // Wait up to 20 seconds for MSAL to complete silent iframe code exchange and acquire a fresh token
    console.log(`[${timestamp}] ⏳ [HEADLESS RENEWER] Waiting for MSAL silent iframe renewal...`);
    let extractedTokens = null;

    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(1000);

      extractedTokens = await page.evaluate(() => {
        let refreshToken = null;
        let accessToken = null;
        let exp = 0;

        // Check localStorage where MSAL stores credentials
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const val = localStorage.getItem(key);
          if (!val) continue;

          try {
            const parsed = JSON.parse(val);
            if (parsed.credentialType === 'AccessToken') {
              const tokenExp = Number(parsed.expiresOn) || 0;
              // Crucial: Only accept tokens that are fresh (expire in the future)
              if (tokenExp * 1000 > Date.now() + 60000) {
                accessToken = parsed.secret;
                exp = tokenExp;
              }
            }
            if (parsed.credentialType === 'RefreshToken' && parsed.secret) {
              refreshToken = parsed.secret;
            }
          } catch (e) {}
        }

        // Also check sessionStorage
        if (!accessToken) {
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            const val = sessionStorage.getItem(key);
            if (!val) continue;

            try {
              const parsed = JSON.parse(val);
              if (parsed.credentialType === 'AccessToken') {
                const tokenExp = Number(parsed.expiresOn) || 0;
                if (tokenExp * 1000 > Date.now() + 60000) {
                  accessToken = parsed.secret;
                  exp = tokenExp;
                }
              }
              if (parsed.credentialType === 'RefreshToken' && parsed.secret) {
                refreshToken = parsed.secret;
              }
            } catch (e) {}
          }
        }

        return { refreshToken, accessToken, exp };
      });

      if (extractedTokens && extractedTokens.accessToken) {
        break;
      }
    }

    if (!extractedTokens || !extractedTokens.accessToken) {
      const currentUrl = page.url();
      console.error(`[${timestamp}] ❌ [HEADLESS RENEWER] Could not extract fresh MSAL tokens. Current URL: ${currentUrl}`);
      await browser.close();
      return { 
        success: false, 
        error: `MSAL tokens not found or Microsoft SSO session expired. Current URL: ${currentUrl}` 
      };
    }

    console.log(`[${timestamp}] ✅ [HEADLESS RENEWER] Successfully extracted fresh MSAL tokens (Expires: ${new Date(extractedTokens.exp * 1000).toISOString()})!`);

    // Save tokens with secure file permissions
    fs.writeFileSync(TOKEN_FILE, extractedTokens.accessToken, { encoding: 'utf8', mode: 0o600 });
    if (extractedTokens.refreshToken) {
      fs.writeFileSync(REFRESH_TOKEN_FILE, extractedTokens.refreshToken, { encoding: 'utf8', mode: 0o600 });
    }

    // Update auth-state.json with renewed session cookies
    await context.storageState({ path: AUTH_STATE_FILE });
    console.log(`[${timestamp}] 💾 [HEADLESS RENEWER] Updated ${AUTH_STATE_FILE} with latest session state.`);

    await browser.close();

    return {
      success: true,
      timestamp: new Date().toISOString(),
      expiresAt: new Date(extractedTokens.exp * 1000).toISOString(),
      refreshTokenPreview: extractedTokens.refreshToken ? extractedTokens.refreshToken.slice(0, 15) + '...' : 'unchanged',
      accessTokenPreview: extractedTokens.accessToken.slice(0, 15) + '...'
    };
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    console.error(`[${timestamp}] ❌ [HEADLESS RENEWER] Exception: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Allow direct CLI execution
if (process.argv[1] && process.argv[1].endsWith('renew-session-headless.js')) {
  runHeadlessRenewal().then(result => {
    console.log('[HEADLESS RENEWER RESULT]', JSON.stringify(result, null, 2));
    if (result.success) {
      exec('pm2 restart prod-automator', () => process.exit(0));
    } else {
      process.exit(1);
    }
  });
}
