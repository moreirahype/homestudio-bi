const { setCors, handleOptions, json } = require("./_lib/http");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(req, res);
  return json(res, 200, { ok: true, service: "High Sales Push" });
};
