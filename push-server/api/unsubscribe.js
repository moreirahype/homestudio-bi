const { setCors, handleOptions, json, readJsonBody } = require("./_lib/http");
const { getSubscription, removeSubscription } = require("./_lib/redis");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(req, res);
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Método inválido." });
  const { id } = readJsonBody(req);
  if (!id) return json(res, 400, { ok: false, error: "ID ausente." });
  const record = await getSubscription(id);
  if (record) await removeSubscription(id, record.audience);
  return json(res, 200, { ok: true });
};
