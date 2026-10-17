// Core Demand Automation Engine with Autonomous Token Refresh & Mon-Fri 8AM - 8PM IST Schedule

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG, getRuntimeConfig } from "./config.js";
import { evaluateDemand } from "./classifier.js";
import { generateCandidatePitch } from "./ai-pitch-generator.js";
import { refreshAccessToken } from "./renew-token.js";
import { runHeadlessRenewal } from "./renew-session-headless.js";
import { sendNtfyNotification } from "./ntfy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_FILE = path.join(__dirname, 'token.txt');
const REFRESH_TOKEN_FILE = path.join(__dirname, 'refresh-token.txt');

const APPLIED_FILE = path.join(__dirname, "applied-demands.json");

function getAppliedHistory() {
  try {
    if (fs.existsSync(APPLIED_FILE)) {
      return JSON.parse(fs.readFileSync(APPLIED_FILE, "utf8"));
    }
  } catch (e) {}
  return [];
}

function saveAppliedRecord(record) {
  try {
    const list = getAppliedHistory();
    list.unshift(record);
    fs.writeFileSync(APPLIED_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save applied record:", e);
  }
}

const STATS_FILE = path.join(__dirname, "stats.json");

function getStoredStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    }
  } catch (e) {}
  return null;
}

function saveEngineStats(stats) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf8");
  } catch (e) {}
}


export class DemandAutomationEngine {
  constructor(options = {}) {
    this.target = options.target || "mock";
    this.baseUrl = options.baseUrl || CONFIG.environments[this.target]?.baseUrl || "http://localhost:3000";
    this.authToken = options.authToken || CONFIG.environments[this.target]?.authToken || null;
    this.intervalMs = options.intervalMs || CONFIG.pollIntervalMs;
    this.mockService = options.mockService || null;
    this.isRunning = false;
    this.timer = null;
    this.renewTimer = null;
    const existingApplied = getAppliedHistory();
    this.appliedDemands = new Set(existingApplied.map(item => item.demandId));
    this.logs = [];
    this.maxLogs = 200;
    this.onLogCallback = options.onLog || null;
    this.lastStandbyLogged = 0;
    this.consecutiveAuthFailures = 0;
    this.lastTokenAlertTime = 0;

    const storedStats = getStoredStats() || {};
    this.stats = {
      cyclesCount: storedStats.cyclesCount || 0,
      totalEvaluated: storedStats.totalEvaluated || 0,
      totalApplied: existingApplied.length,
      lastLatencyMs: storedStats.lastLatencyMs || 0,
      totalSkippedAlreadyApplied: storedStats.totalSkippedAlreadyApplied || 0,
      totalSkippedPythonOnly: storedStats.totalSkippedPythonOnly || 0,
      lastCycleTime: storedStats.lastCycleTime || null
    };
  }

  isWithinOperatingHours() {
    const runtime = getRuntimeConfig();
    if (runtime.autoStandby === false || runtime.standbyOverride === true) {
      return true; // Auto-standby is DISABLED -> run 24/7 continuously!
    }
    if (!CONFIG.schedule || !CONFIG.schedule.enabled) return true;
    try {
      const istString = new Date().toLocaleString("en-US", { timeZone: CONFIG.schedule.timezone || "Asia/Kolkata" });
      const istDate = new Date(istString);
      const currentDay = istDate.getDay(); // 0 = Sunday, 6 = Saturday
      const currentHour = istDate.getHours();

      // Check if current day is an allowed weekday (Monday - Friday)
      const allowedDays = CONFIG.schedule.daysOfWeek || [1, 2, 3, 4, 5];
      if (!allowedDays.includes(currentDay)) {
        return false;
      }

      // Check if current hour is within 8:00 AM - 8:00 PM
      return currentHour >= CONFIG.schedule.startHour && currentHour < CONFIG.schedule.endHour;
    } catch (e) {
      return true;
    }
  }

  getStandbyReason() {
    try {
      const istString = new Date().toLocaleString("en-US", { timeZone: CONFIG.schedule?.timezone || "Asia/Kolkata" });
      const istDate = new Date(istString);
      const day = istDate.getDay();
      const timeStr = istDate.toLocaleTimeString("en-US");
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const currentDayName = dayNames[day];

      if (day === 0 || day === 6) {
        return `🏖️ Weekend standby [${currentDayName}]. Engine runs Mon–Fri (8:00 AM – 8:00 PM IST). Sleeping until Monday 8:00 AM IST.`;
      }
      return `🌙 Outside operating hours [Current IST: ${currentDayName} ${timeStr}]. Engine active Mon–Fri (8:00 AM – 8:00 PM IST). Sleeping until 8:00 AM IST.`;
    } catch (e) {
      return "Outside operating hours. Sleeping until next active window.";
    }
  }

  getAuthToken() {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        const fileToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
        if (fileToken) return fileToken;
      }
    } catch (e) {}
    return this.authToken;
  }

  hasRefreshToken() {
    try {
      return fs.existsSync(REFRESH_TOKEN_FILE) && fs.readFileSync(REFRESH_TOKEN_FILE, 'utf8').trim().length > 0;
    } catch (e) {
      return false;
    }
  }

  log(level, message, details = null) {
    const entry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    const istTimeStr = new Date().toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    console.log(`[${istTimeStr}] [${level}] ${message}`);
    if (this.onLogCallback) {
      try {
        this.onLogCallback(entry);
      } catch (e) {
        console.error("Error in onLogCallback:", e);
      }
    }
    return entry;
  }

  async notifyTokenExpired() {
    const now = Date.now();
    // Rate-limit alert to once every 2 hours to avoid spamming
    if (this.lastTokenAlertTime && (now - this.lastTokenAlertTime < 2 * 60 * 60 * 1000)) {
      return;
    }
    this.lastTokenAlertTime = now;

    try {
      const runtime = getRuntimeConfig();
      const topic = (runtime.ntfy?.topic || runtime.whatsapp?.topic || "bench-bot-3177277").trim();
      const cleanTopic = encodeURIComponent(topic.replace(/^https?:\/\/ntfy\.sh\//i, '').replace(/[^a-zA-Z0-9_-]/g, ''));
      if (!cleanTopic) return;

      const istTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
      await fetch(`https://ntfy.sh/${cleanTopic}`, {
        method: "POST",
        headers: {
          "Title": "Action Required: Azure SSO Token Expired",
          "Priority": "urgent",
          "Tags": "warning,key"
        },
        body: [
          "⚠️ AUTOMATOR ENTERED SAFE STANDBY",
          "",
          "Your 24-hour Microsoft SSO portal token has expired.",
          "The automator has paused rapid scanning to protect your AWS server.",
          "",
          "👉 Open the Web Dashboard to paste a fresh token and resume auto-applying.",
          "",
          `🕒 ${istTime} IST`
        ].join("\n")
      });
      this.log("INFO", "🚨 Emergency token expiration alert dispatched to phone via ntfy!");
    } catch (e) {
      this.log("WARN", "Could not send token expiration alert: " + e.message);
    }
  }

  scheduleNextTick() {
    if (!this.isRunning) return;
    const runtime = getRuntimeConfig();
    let baseSec = runtime.pollIntervalSeconds || Math.round(this.intervalMs / 1000) || 30;

    // Circuit Breaker: throttle to 15 min if token is expired to protect server resources
    if (this.consecutiveAuthFailures >= 2) {
      baseSec = 900;
    }

    // Human jitter: between -3.0s and +3.0s (proportional if baseSec < 15s)
    const maxJitter = Math.min(3, Math.max(1, Math.round(baseSec * 0.15)));
    const jitterSec = Number(((Math.random() * (maxJitter * 2)) - maxJitter).toFixed(1));
    const nextIntervalMs = Math.max(5000, Math.round((baseSec + jitterSec) * 1000));

    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        this.log("ERROR", `Error in cycle tick: ${err.message}`);
      } finally {
        this.scheduleNextTick();
      }
    }, nextIntervalMs);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    const runtime = getRuntimeConfig();
    const baseSec = runtime.pollIntervalSeconds || Math.round(this.intervalMs / 1000) || 30;
    this.intervalMs = baseSec * 1000;

    const isAutoStandbyDisabled = runtime.autoStandby === false || runtime.standbyOverride === true;
    const scheduleInfo = isAutoStandbyDisabled
      ? " | ⚡ Auto-Standby: DISABLED (24/7 Mode)"
      : (CONFIG.schedule?.enabled
        ? ` | Schedule: Mon-Fri, ${CONFIG.schedule.startHour}:00 AM - ${CONFIG.schedule.endHour - 12}:00 PM IST (Weekends Excluded)`
        : "");
    this.log("INFO", `Starting Demand Automation Engine targeting [${this.target.toUpperCase()}] at ${this.baseUrl} (Base: ${baseSec}s with ±3s human jitter${scheduleInfo})`);
    
    (async () => {
      try {
        await this.tick();
      } catch (err) {
        this.log("ERROR", `Initial tick failed: ${err.message}`);
      } finally {
        this.scheduleNextTick();
      }
    })();

    // Schedule autonomous token renewal every 45 minutes
    this.renewTimer = setInterval(async () => {
      if (this.hasRefreshToken()) {
        this.log("INFO", "Running scheduled 45-minute autonomous token renewal...");
        const res = await refreshAccessToken();
        if (res.success) {
          this.log("SUCCESS", `Token auto-renewed successfully! Valid for next ${Math.round(res.expiresIn / 60)} minutes.`);
        } else {
          this.log("WARN", `Scheduled token renewal failed: ${res.error}. Attempting autonomous headless session renewal...`);
          try {
            const headlessRes = await runHeadlessRenewal();
            if (headlessRes.success) {
              this.log("SUCCESS", "Headless browser successfully renewed Azure AD session tokens!");
            } else {
              this.log("ERROR", `Headless browser renewal failed: ${headlessRes.error}`);
            }
          } catch (hErr) {
            this.log("ERROR", `Error invoking headless session renewal: ${hErr.message}`);
          }
        }
      }
    }, 45 * 60 * 1000);

    // Proactive daily headless session renewal every 20 hours to prevent 24-hour token expiry
    this.dailyHeadlessTimer = setInterval(async () => {
      this.log("INFO", "Running scheduled 20-hour proactive headless session renewal...");
      try {
        const headlessRes = await runHeadlessRenewal();
        if (headlessRes.success) {
          this.log("SUCCESS", "Proactive headless session renewal succeeded! 24-hour window reset.");
        } else {
          this.log("WARN", `Proactive headless renewal notice: ${headlessRes.error}`);
        }
      } catch (hErr) {
        this.log("ERROR", `Proactive headless renewal exception: ${hErr.message}`);
      }
    }, 20 * 60 * 60 * 1000);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
    if (this.dailyHeadlessTimer) {
      clearInterval(this.dailyHeadlessTimer);
      this.dailyHeadlessTimer = null;
    }
    this.log("WARN", "Demand Automation Engine has been paused.");
  }

  async fetchWithRetry(url, options = {}) {
    let token = this.getAuthToken();
    let headers = { ...(options.headers || {}) };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const startFetch = Date.now();
    let response = await fetch(url, { ...options, headers });
    this.stats.lastLatencyMs = Date.now() - startFetch;

    // Handle 401 Unauthorized with Circuit Breaker
    if (response.status === 401) {
      this.consecutiveAuthFailures = (this.consecutiveAuthFailures || 0) + 1;
      this.log("WARN", `Received HTTP 401 Unauthorized (Auth failure count: ${this.consecutiveAuthFailures}). Attempting recovery...`);

      if (this.consecutiveAuthFailures > 2) {
        await this.notifyTokenExpired();
        return response;
      }

      let refreshed = false;
      if (this.hasRefreshToken()) {
        const renew = await refreshAccessToken();
        if (renew.success) {
          this.log("SUCCESS", `Token automatically refreshed via Azure AD! Retrying request...`);
          token = this.getAuthToken();
          headers["Authorization"] = `Bearer ${token}`;
          response = await fetch(url, { ...options, headers });
          if (response.status !== 401) {
            this.consecutiveAuthFailures = 0;
            refreshed = true;
          }
        } else {
          this.log("ERROR", `Autonomous token refresh failed: ${renew.error}`);
        }
      }

      if (!refreshed) {
        // Fallback: Autonomous Headless Browser Session Renewal (at most once)
        try {
          this.log("INFO", "Triggering autonomous headless browser session renewal...");
          const headlessRes = await runHeadlessRenewal();
          if (headlessRes.success) {
            this.log("SUCCESS", `Headless browser renewed session! Retrying request with fresh token...`);
            token = this.getAuthToken();
            headers["Authorization"] = `Bearer ${token}`;
            response = await fetch(url, { ...options, headers });
            if (response.status !== 401) {
              this.consecutiveAuthFailures = 0;
              refreshed = true;
            }
          } else {
            this.log("ERROR", `Headless session renewal failed: ${headlessRes.error}`);
          }
        } catch (hErr) {
          this.log("ERROR", `Error invoking headless session renewal: ${hErr.message}`);
        }
      }

      if (response.status === 401 && this.consecutiveAuthFailures >= 2) {
        this.log("STANDBY", "Continuous 401 Unauthorized: entering Safe Standby Mode (15m interval) to protect server.");
        await this.notifyTokenExpired();
      }
    } else if (response.ok) {
      this.consecutiveAuthFailures = 0;
    }

    return response;
  }

  async tick() {
    const runtime = getRuntimeConfig();
    const isAutoStandbyDisabled = runtime.autoStandby === false || runtime.standbyOverride === true;

    // Check Monday - Friday (8:00 AM - 8:00 PM IST) Operational Window
    if (!this.isWithinOperatingHours()) {
      if (!this.lastStandbyLogged || (Date.now() - this.lastStandbyLogged > 30 * 60 * 1000)) {
        this.log("STANDBY", this.getStandbyReason());
        this.lastStandbyLogged = Date.now();
      }
      return;
    }
    if (isAutoStandbyDisabled && !this.overrideLogged) {
      this.log("INFO", "⚡ Auto-Standby is DISABLED: Running 24/7 continuously without schedule restrictions.");
      this.overrideLogged = true;
    } else if (!isAutoStandbyDisabled) {
      this.overrideLogged = false;
    }
    this.lastStandbyLogged = 0;

    this.stats.cyclesCount++;
    this.stats.lastCycleTime = new Date().toISOString();
    this.log("INFO", `Cycle #${this.stats.cyclesCount}: Querying demands with active filters...`);

    try {
      const payload = {
        businessUnit: CONFIG.filters.businessUnit,
        location: CONFIG.filters.location,
        jobDescription: CONFIG.filters.jobDescription,
        genus: CONFIG.filters.genus,
        status: CONFIG.filters.status,
        demandIds: CONFIG.filters.demandIds,
        userActionStatuses: CONFIG.filters.userActionStatuses,
        page: CONFIG.filters.page
      };

      let allDemands = [];
      let currentPage = 1;
      let totalPages = 1;

      do {
        payload.page = { ...CONFIG.filters.page, pageNumber: currentPage };
        let pageDemands = [];

        if (this.target === "mock" && this.mockService) {
          const res = this.mockService.fetchDemands(payload);
          pageDemands = res.content || [];
          totalPages = res.totalPages || 1;
        } else {
          const fetchUrl = `${this.baseUrl}/api/demand/fetchDemands`;
          const response = await this.fetchWithRetry(fetchUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText} from ${fetchUrl}`);
          }

          const data = await response.json();
          pageDemands = data.content || (Array.isArray(data) ? data : []);
          totalPages = data.totalPages || 1;
        }

        allDemands.push(...pageDemands);
        currentPage++;
      } while (currentPage <= totalPages);

      const demands = allDemands;
      this.log("INFO", `Cycle #${this.stats.cyclesCount}: Scanned ALL ${totalPages} page(s) -> Total ${demands.length} demands evaluated.`);

      for (const demand of demands) {
        this.stats.totalEvaluated++;
        const demandId = demand.demandId || demand.id;

        if (demand.interested || this.appliedDemands.has(demandId)) {
          this.stats.totalSkippedAlreadyApplied++;
          this.log("SKIP", `Demand ${demandId} (${demand.genus}): Already applied.`);
          continue;
        }

        const evaluation = evaluateDemand(demand);

        if (!evaluation.eligible) {
          this.log("SKIP", `Demand ${demandId} (${demand.genus}): ${evaluation.reason}`);
          if (evaluation.reason.includes("Only Python")) {
            this.stats.totalSkippedPythonOnly++;
          }
          continue;
        }

        this.log("INFO", `Demand ${demandId} (${demand.genus}) QUALIFIES! [${evaluation.reason}]. Initiating AI application...`);
        await this.applyForDemand(demand);
      }

      saveEngineStats(this.stats);

    } catch (err) {
      this.log("ERROR", `Cycle #${this.stats.cyclesCount} failed: ${err.message}`);
    }
  }

  async applyForDemand(demand) {
    const demandId = demand.demandId || demand.id;
    try {
      const resumePath = CONFIG.candidateProfile.resumePath;
      const resumeFileName = CONFIG.candidateProfile.resumeFileName;

      const checkedSkills = Array.isArray(demand.additionalSkills) && demand.additionalSkills.length > 0
        ? demand.additionalSkills.map(s => typeof s === "string" ? s.trim() : (s?.name || "").trim()).filter(Boolean)
        : ["React", "Angular", "JavaScript", "TypeScript", "Python"];

      this.log("INFO", `[${demandId}] Selected all must-have skills: [${checkedSkills.join(", ")}]`);

      this.log("INFO", `[${demandId}] Generating AI pitch for "What sets you apart" tailored to ${demand.genus}...`);
      const aiPitch = await generateCandidatePitch(demand);

      let uploadedFileName = resumeFileName;
      this.log("INFO", `[${demandId}] Step 1/2: Uploading resume file (${resumeFileName})...`);

      if (this.target === "mock" && this.mockService) {
        const uploadRes = this.mockService.uploadResume(demandId, resumeFileName);
        uploadedFileName = uploadRes.fileName;
      } else {
        let fileBuffer;
        if (fs.existsSync(resumePath)) {
          fileBuffer = fs.readFileSync(resumePath);
        } else {
          fileBuffer = Buffer.from("Resume file content");
        }

        const formData = new FormData();
        const fileBlob = new Blob([fileBuffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
        formData.append("file", fileBlob, resumeFileName);

        const uploadUrl = `${this.baseUrl}/api/demand/file?identifier=${demandId}`;
        const uploadRes = await this.fetchWithRetry(uploadUrl, {
          method: "POST",
          body: formData
        });

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          if (uploadData && uploadData.fileName) {
            uploadedFileName = uploadData.fileName;
          }
        }
      }

      this.log("INFO", `[${demandId}] Step 2/2: Submitting interest with AI pitch (${aiPitch.length} chars) & ${checkedSkills.length} skills...`);

      const interestPayload = {
        candidateComments: aiPitch,
        fileName: uploadedFileName,
        additionalSkills: checkedSkills
      };

      if (this.target === "mock" && this.mockService) {
        this.mockService.submitInterest(demandId, interestPayload);
      } else {
        const interestUrl = `${this.baseUrl}/api/demand/${demandId}/interest`;
        const interestRes = await this.fetchWithRetry(interestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(interestPayload)
        });

        if (!interestRes.ok) {
          throw new Error(`Failed to submit interest: HTTP ${interestRes.status} ${interestRes.statusText}`);
        }
      }

      saveAppliedRecord({
        demandId,
        genus: demand.genus,
        location: Array.isArray(demand.location) ? demand.location.join(", ") : (demand.location || "India - Gurugram / WFA"),
        skills: checkedSkills,
        pitch: aiPitch,
        appliedAt: new Date().toISOString()
      });
      this.appliedDemands.add(demandId);
      this.stats.totalApplied++;
      saveEngineStats(this.stats);
      this.log("SUCCESS", `🎉 APPLIED to ${demandId} (${demand.genus})! Skills checked: ${checkedSkills.length}. AI pitch submitted.`);

      // Instant Push Notification (non-blocking, failsafe)
      sendNtfyNotification({
        demandId,
        genus: demand.genus,
        location: demand.location,
        skills: checkedSkills,
        pitch: aiPitch
      }).then(res => {
        if (res && res.success) {
          this.log("INFO", `🔔 Push notification dispatched to ntfy for Demand ${demandId}.`);
        }
      }).catch(() => {});

    } catch (err) {
      this.log("ERROR", `[${demandId}] Application submission failed: ${err.message}`);
    }
  }
}
