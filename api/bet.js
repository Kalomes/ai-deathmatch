import { get, set } from '../lib/storage.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { ai, amount } = req.body;
  if (!ai || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid' });

  const round = await get('current_round');
  if (!round) return res.status(404).json({ error: 'No active round' });
  if (Date.now() >= new Date(round.ends_at)) return res.status(400).json({ error: 'Round over' });

  round.bets = round.bets || { ai1: 0, ai2: 0 };
  if (ai === 1) round.bets.ai1 += parseFloat(amount);
  else          round.bets.ai2 += parseFloat(amount);

  await set('current_round', round);
  return res.json({ ok: true, bets: round.bets });
}