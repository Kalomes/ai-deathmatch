const URL   = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

async function dbGet(key) {
  if (!URL) return null;
  try {
    const r = await fetch(`${URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}

async function dbSet(key, value) {
  if (!URL) return;
  await fetch(`${URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
}

export { dbGet as get, dbSet as set };