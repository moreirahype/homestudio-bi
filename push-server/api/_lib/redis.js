function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Redis da Upstash não configurado.");
  return { url: url.replace(/\/$/, ""), token };
}

async function redis(command) {
  const { url, token } = getRedisConfig();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error(`Redis respondeu ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

async function saveSubscription(id, record) {
  await redis(["SET", `push:subscription:${id}`, JSON.stringify(record)]);
  await redis(["SADD", `push:audience:${record.audience}`, id]);
}

async function getSubscription(id) {
  const value = await redis(["GET", `push:subscription:${id}`]);
  return value ? JSON.parse(value) : null;
}

async function listSubscriptions(audience) {
  const ids = (await redis(["SMEMBERS", `push:audience:${audience}`])) || [];
  const records = await Promise.all(ids.map(async (id) => {
    const record = await getSubscription(id);
    return record ? { id, ...record } : null;
  }));
  return records.filter(Boolean);
}

async function removeSubscription(id, audience) {
  await redis(["DEL", `push:subscription:${id}`]);
  if (audience) await redis(["SREM", `push:audience:${audience}`, id]);
}

module.exports = { redis, saveSubscription, getSubscription, listSubscriptions, removeSubscription };
