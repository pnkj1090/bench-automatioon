// ntfy.sh Instant Mobile & Desktop Push Notification Service for Demand Automator
import { getRuntimeConfig } from "./config.js";

/**
 * Send an instant push notification via ntfy.sh
 * @param {Object} details - Details about the auto-applied demand
 * @param {string} details.demandId - The ID of the demand
 * @param {string} details.genus - The genus / role title
 * @param {string|Array} details.location - The location(s)
 * @param {Array} details.skills - List of skills checked
 * @param {string} details.pitch - The candidate pitch submitted
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendNtfyNotification(details) {
  try {
    const runtime = getRuntimeConfig();
    const config = runtime.ntfy || runtime.whatsapp;

    if (!config || !config.enabled) {
      return { success: false, reason: "disabled" };
    }

    const topic = (config.topic || "").trim();
    if (!topic) {
      return { success: false, reason: "missing_topic" };
    }

    const demandId = details.demandId || "Unknown";
    const genus = details.genus || "Frontend";
    const locationStr = Array.isArray(details.location) ? details.location.join(", ") : (details.location || "India - Gurugram / WFA");
    const skillsList = Array.isArray(details.skills) && details.skills.length > 0 ? details.skills.slice(0, 5).join(", ") : "Matched Requirements";
    
    // Pitch preview (first 250 characters)
    let pitchPreview = (details.pitch || "").trim();
    if (pitchPreview.length > 250) {
      pitchPreview = pitchPreview.substring(0, 247) + "...";
    }

    const istTime = new Date().toLocaleString("en-US", { 
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    });

    // Keep Title strictly ASCII for HTTP header compatibility
    const title = `Demand Applied: ${demandId} (${genus})`;
    const body = [
      `🎉 DEMAND AUTO-APPLIED!`,
      ``,
      `📋 Demand ID: ${demandId}`,
      `💼 Role: ${genus}`,
      `📍 Location: ${locationStr}`,
      `🛠️ Skills Checked: ${skillsList}`,
      ``,
      `📝 Pitch Preview:`,
      pitchPreview || "Standard tailored candidate pitch submitted.",
      ``,
      `🕒 Applied At: ${istTime} IST`,
      `🌐 Portal: Nagarro Opportunistic Placement`
    ].join("\n");

    return await executeNtfy(topic, title, body, [
      {
        action: "view",
        label: "Open Portal",
        url: "https://opportunistic-placement.azurewebsites.net/demands"
      }
    ]);
  } catch (err) {
    console.error("[ntfy] Error sending notification:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a quick test notification to verify ntfy topic connectivity
 */
export async function sendTestNtfyNotification(topic) {
  const cleanTopic = (topic || "").trim();
  if (!cleanTopic) {
    return { success: false, error: "Topic name is required." };
  }

  const istTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  // Strictly ASCII title for HTTP headers
  const title = "Nagarro Demand Automator Connected";
  const body = [
    "✅ ntfy push notifications are connected successfully!",
    "",
    "You will receive an instant alert on this phone channel each time a qualifying demand is auto-applied.",
    "",
    `🕒 ${istTime} IST`
  ].join("\n");

  return await executeNtfy(cleanTopic, title, body);
}

async function executeNtfy(topic, title, body, actions = []) {
  const cleanTopic = encodeURIComponent(topic.trim().replace(/^https?:\/\/ntfy\.sh\//i, '').replace(/[^a-zA-Z0-9_-]/g, ''));
  if (!cleanTopic) {
    return { success: false, error: "Invalid topic name." };
  }

  const url = `https://ntfy.sh/${cleanTopic}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

  try {
    const headers = {
      "Title": title,
      "Priority": "high",
      "Tags": "tada,briefcase",
      "Click": "https://opportunistic-placement.azurewebsites.net/demands"
    };

    if (actions && actions.length > 0) {
      headers["Actions"] = JSON.stringify(actions);
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      return { success: true };
    } else {
      const errText = await res.text();
      return { success: false, error: errText || `HTTP ${res.status}` };
    }
  } catch (err) {
    clearTimeout(timeout);
    return { success: false, error: err.name === "AbortError" ? "Request timed out" : err.message };
  }
}

// Backward-compatible aliases for seamless drop-in
export const sendWhatsAppNotification = sendNtfyNotification;
export const sendTestWhatsAppMessage = (phone, apiKey) => sendTestNtfyNotification(apiKey || phone);
