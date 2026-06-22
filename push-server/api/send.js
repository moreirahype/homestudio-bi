const { setCors, handleOptions, json, readJsonBody, isAuthorized } = require("./_lib/http");
const { listSubscriptions } = require("./_lib/redis");
const { sendToRecord } = require("./_lib/push");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(req, res);
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Método inválido." });
  if (!isAuthorized(req)) return json(res, 401, { ok: false, error: "Não autorizado." });

  const body = readJsonBody(req);
  const audience = body.audience === "sheila" ? "sheila" : body.audience === "owner" ? "owner" : "";
  if (!audience || !body.title) return json(res, 400, { ok: false, error: "Payload inválido." });

  let records = await listSubscriptions(audience);
  records = records.filter((record) => record.preferences?.enabled !== false);
  if (audience === "owner" && body.kind === "sale") {
    records = records.filter((record) => record.preferences?.salesEnabled !== false);
  }
  if (audience === "owner" && body.time) {
    records = records.filter((record) => (record.preferences?.times || []).includes(body.time));
  }

  const results = await Promise.all(records.map((record) => sendToRecord(record, {
    title: body.title,
    body: body.body || "",
    url: body.url || "/",
    tag: body.tag || `hsbi-${audience}`
  })));
  return json(res, 200, {
    ok: true,
    audience,
    attempted: records.length,
    delivered: results.filter((result) => result.ok).length,
    expired: results.filter((result) => result.expired).length
  });
};
