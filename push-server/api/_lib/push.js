const webpush = require("web-push");
const { removeSubscription } = require("./redis");

function configureWebPush() {
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("Chaves VAPID não configuradas.");
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

async function sendToRecord(record, payload) {
  configureWebPush();
  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payload), {
      TTL: 300,
      urgency: "high"
    });
    return { ok: true };
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      await removeSubscription(record.id, record.audience);
      return { ok: false, expired: true };
    }
    return { ok: false, error: error.message || String(error) };
  }
}

module.exports = { sendToRecord };
