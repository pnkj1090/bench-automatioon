// CallMeBot WhatsApp Notification Service for Nagarro Bench Automator
import { getRuntimeConfig } from "./config.js";

/**
 * Send a WhatsApp notification via CallMeBot API
 * @param {Object} details - Details about the auto-applied demand
 * @param {string} details.demandId - The ID of the demand
 * @param {string} details.genus - The genus / role title
 * @param {string|Array} details.location - The location(s)
 * @param {Array} details.skills - List of skills checked
 * @param {string} details.pitch - The candidate pitch submitted
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendWhatsAppNotification(details) {
  try {
    const runtime = getRuntimeConfig();
    const config = runtime.whatsapp;

    if (!config || !config.enabled) {
      return { success: false, reason: "disabled" };
    }

    const phone = (config.phone || "").trim().replace(/[^0-9+]/g, "");
    const apiKey = (config.apiKey || "").trim();

    if (!phone || !apiKey) {
      return { success: false, reason: "missing_credentials" };
    }

    const demandId = details.demandId || "Unknown";
    const genus = details.genus || "Frontend";
    const locationStr = Array.isArray(details.location) ? details.location.join(", ") : (details.location || "India - Gurugram / WFA");
    const skillsList = Array.isArray(details.skills) && details.skills.length > 0 ? details.skills.slice(0, 5).join(", ") : "Matched Requirements";
    
    // Short pitch preview (first 160 characters)
    let pitchPreview = (details.pitch || "").trim();
    if (pitchPreview.length > 160) {
      pitchPreview = pitchPreview.substring(0, 157) + "...";
    }

    const istTime = new Date().toLocaleString("en-US", { 
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    });

    const message = [
      "🎉 *DEMAND AUTO-APPLIED!*",
      "",
      "📋 *Demand ID:* " + demandId,
      "💼 *Role / Genus:* " + genus,
      "📍 *Location:* " + locationStr,
      "🛠️ *Skills Checked:* " + skillsList,
      "",
      "📝 *AI Pitch Preview:*",
      pitchPreview || "Standard tailored candidate pitch submitted.",
      "",
      "🕒 *Applied At:* " + istTime + " IST",
      "🌐 *Portal:* Nagarro Opportunistic Placement"
    ].join("\n");

    return await executeCallMeBot(phone, apiKey, message);
  } catch (err) {
    console.error("[WhatsApp] Error sending notification:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a quick test WhatsApp message to verify CallMeBot credentials
 */
export async function sendTestWhatsAppMessage(phone, apiKey) {
  const cleanPhone = (phone || "").trim().replace(/[^0-9+]/g, "");
  const cleanKey = (apiKey || "").trim();

  if (!cleanPhone || !cleanKey) {
    return { success: false, error: "Phone number and API Key are required." };
  }

  const message = [
    "⚡ *NAGARRO DEMAND AUTOMATOR*",
    "",
    "✅ WhatsApp Notifications are connected successfully!",
    "You will receive an alert here each time a qualifying demand is auto-applied.",
    "",
    "🕒 " + new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }) + " IST"
  ].join("\n");

  return await executeCallMeBot(cleanPhone, cleanKey, message);
}

async function executeCallMeBot(phone, apiKey, text) {
  // CallMeBot expects phone in international format (e.g. +919876543210 or 919876543210)
  const cleanPhone = phone.startsWith("+") ? phone : ("+" + phone);
  const encodedText = encodeURIComponent(text);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodedText}&apikey=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeout);

    const body = await res.text();
    // CallMeBot returns 200 with HTML or message like "Message queued" or "Success"
    if (res.ok && (body.includes("Message queued") || body.includes("Success") || body.includes("Message Sent") || body.length < 500)) {
      return { success: true, response: body };
    } else {
      return { success: false, error: body || ("HTTP " + res.status) };
    }
  } catch (err) {
    clearTimeout(timeout);
    return { success: false, error: err.name === "AbortError" ? "Request timed out" : err.message };
  }
}
