const crypto = require("crypto");
const { setCors, handleOptions, json, readJsonBody } = require("./_lib/http");
const { saveSubscription } = require("./_lib/redis");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(req, res);
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Método inválido." });

  const body = readJsonBody(req);
  const audience = body.audience === "sheila" ? "sheila" : body.audience === "owner" ? "owner" : "";
  const subscription = body.subscription;
  if (!audience || !subscription || !subscription.endpoint || !subscription.keys) {
    return json(res, 400, { ok: false, error: "Assinatura inválida." });
  }

  const id = crypto.createHash("sha256").update(`${audience}:${subscription.endpoint}`).digest("hex");
  const preferences = {
    enabled: body.preferences?.enabled !== false,
    times: Array.isArray(body.preferences?.times) ? body.preferences.times : [],
    salesEnabled: body.preferences?.salesEnabled !== false
  };
  await saveSubscription(id, {
    audience,
    subscription,
    preferences,
    updatedAt: new Date().toISOString()
  });
  return json(res, 200, { ok: true, id });
};
