import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, 'aws-bill-cache.json');

// Ensure dotenv is loaded from current dir or user home
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(os.homedir(), '.env') });

export function getCachedAwsBill() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read AWS bill cache:', e);
  }
  return null;
}

export function saveCachedAwsBill(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save AWS bill cache:', e);
  }
}

export function fetchLatestAwsBill() {
  return new Promise((resolve, reject) => {
    const accessKey = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

    const env = {
      ...process.env,
      AWS_DEFAULT_REGION: 'us-east-1' // Cost Explorer endpoint is in us-east-1
    };
    if (accessKey) env.AWS_ACCESS_KEY_ID = accessKey;
    if (secretKey) env.AWS_SECRET_ACCESS_KEY = secretKey;

    const now = new Date();
    // Start of current month (UTC)
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    // End date must be greater than start, exclusive. Use tomorrow in UTC.
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10);

    const cmd = `aws ce get-cost-and-usage --time-period Start=${start},End=${tomorrow} --granularity MONTHLY --metrics UnblendedCost NetUnblendedCost --group-by Type=DIMENSION,Key=SERVICE`;

    exec(cmd, { env, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error('AWS Cost Explorer exec error:', stderr || err.message);
        return reject(new Error(stderr || err.message));
      }

      try {
        const parsed = JSON.parse(stdout);
        const resultItem = parsed.ResultsByTime?.[0];
        if (!resultItem) {
          throw new Error('No cost data returned by AWS Cost Explorer');
        }

        // Breakdown by service
        const services = (resultItem.Groups || [])
          .map(g => ({
            service: g.Keys?.[0] || 'Unknown',
            amount: parseFloat(g.Metrics?.UnblendedCost?.Amount || '0'),
            netAmount: parseFloat(g.Metrics?.NetUnblendedCost?.Amount || g.Metrics?.UnblendedCost?.Amount || '0'),
            unit: g.Metrics?.UnblendedCost?.Unit || 'USD'
          }))
          .filter(s => s.amount > 0)
          .sort((a, b) => b.amount - a.amount);

        const totalUnblended = services.reduce((acc, s) => acc + s.amount, 0);
        const totalNet = services.reduce((acc, s) => acc + (s.netAmount !== undefined ? s.netAmount : s.amount), 0);
        const unit = services[0]?.unit || 'USD';

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const currentMonthName = monthNames[now.getUTCMonth()] + ' ' + now.getUTCFullYear();

        const istTimeStr = new Date().toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });

        const billData = {
          amount: totalUnblended.toFixed(2),
          exactAmount: totalUnblended.toFixed(4),
          netAmount: totalNet.toFixed(2),
          unit: unit,
          period: `${monthShort[now.getUTCMonth()]} 1 - ${now.getUTCDate()}, ${now.getUTCFullYear()}`,
          monthName: currentMonthName,
          services: services,
          updatedAt: new Date().toISOString(),
          updatedAtFormatted: istTimeStr + ' IST',
          estimated: resultItem.Estimated !== false
        };

        saveCachedAwsBill(billData);
        resolve(billData);
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}
