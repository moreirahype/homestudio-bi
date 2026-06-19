const { setCors, handleOptions, json, readJsonBody } = require("./_lib/http");
const { redis, getSubscription } = require("./_lib/redis");
const { sendToRecord } = require("./_lib/push");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(req, res);
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Método inválido." });
  const { id, audience, title, body, url } = readJsonBody(req);
  if (!id) return json(res, 400, { ok: false, error: "Ative as notificações primeiro." });
  const record = await getSubscription(id);
  if (!record || record.audience !== audience) {
    return json(res, 404, { ok: false, error: "Assinatura não encontrada." });
  }
  const allowed = await redis(["SET", `push:test:${id}`, "1", "EX", 20, "NX"]);
  if (!allowed) return json(res, 429, { ok: false, error: "Aguarde alguns segundos e tente novamente." });
  const result = await sendToRecord({ id, ...record }, {
    title: title || (audience === "sheila" ? "Venda Realizada! 💰" : "Resumo das Campanhas!"),
    body: body || "",
    url: url || "/",
    tag: `hsbi-test-${audience}`
  });
  return json(res, result.ok ? 200 : 502, result);
};
