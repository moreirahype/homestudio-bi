function setCors(req, res) {
  const configured = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = req.headers.origin || "";
  const allowed = !configured.length || configured.includes(origin);
  res.setHeader("Access-Control-Allow-Origin", allowed && origin ? origin : configured[0] || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Cache-Control", "no-store");
}

function handleOptions(req, res) {
  if (req.method !== "OPTIONS") return false;
  setCors(req, res);
  res.status(204).end();
  return true;
}

function json(res, status, payload) {
  res.status(status).json(payload);
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (!req.body) return {};
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function isAuthorized(req) {
  const expected = process.env.PUSH_API_SECRET;
  if (!expected) return false;
  return req.headers.authorization === `Bearer ${expected}`;
}

module.exports = { setCors, handleOptions, json, readJsonBody, isAuthorized };
