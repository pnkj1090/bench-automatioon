// Re-export ntfy push notification service for full backward compatibility
export {
  sendNtfyNotification as sendWhatsAppNotification,
  sendTestNtfyNotification as sendTestWhatsAppMessage,
  sendNtfyNotification,
  sendTestNtfyNotification
} from "./ntfy.js";
