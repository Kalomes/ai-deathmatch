export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const UPSTASH_URL = process.env.KV_REST_API_URL;
  const UPSTASH_TOK = process.env.KV_REST_API_TOKEN;

  if (!UPSTASH_URL) return res.json({ error: 'no upstash' });

  async function del(key) {
    await fetch(`${UPSTASH_URL}/del/${key}`,
      { headers: { Authorization: `Bearer ${UPSTASH_TOK}` } });
  }

  await del('round');
  // scores и history не трогаем — статистика сохраняется

  return res.json({ ok: true, message: 'round cleared, call /api/new-round now' });
}