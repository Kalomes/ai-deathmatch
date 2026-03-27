export const config = { maxDuration: 15 };

const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOK = process.env.KV_REST_API_TOKEN;

async function dbGet(key) {
  if (!UPSTASH_URL) return null;
  try {
    const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${UPSTASH_TOK}` } });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}

async function refreshPositions(positions = []) {
  return Promise.all(positions.map(async pos => {
    try {
      let cp = pos.currentPrice || pos.entryPrice || 0.5;

      if (!pos.isSimulated && pos.tokenId) {
        const r = await Promise.race([
          fetch(`https://clob.polymarket.com/midpoint?token_id=${pos.tokenId}`)
            .then(r => r.json()),
          new Promise(r => setTimeout(() => r({ mid: null }), 2000))
        ]);
        if (r?.mid) cp = Math.max(0.01, Math.min(0.99, parseFloat(r.mid)));
      } else {
        // simulated: tiny noise ±0.5%
        cp = Math.max(0.01, Math.min(0.99, cp + (Math.random() - 0.5) * 0.01));
      }

      // ✅ CORRECT perp-style PNL
      // shares = positionSize / entryPrice = (allocation × leverage) / entryPrice
      // pnl = (currentPrice - entryPrice) × shares
      // entry=now → pnl=0 ✅
      const pnl = (cp - pos.entryPrice) * (pos.shares || 0);

      return {
        ...pos,
        currentPrice: +cp.toFixed(4),
        pnl: +pnl.toFixed(2)
      };
    } catch {
      return { ...pos, pnl: 0 };
    }
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const [round, history, scores] = await Promise.all([
      dbGet('round'),
      dbGet('history'),
      dbGet('scores')
    ]);

    const safeScores = scores || { ai1: 0, ai2: 0, rounds: 0 };

    if (!round) {
      return res.json({
        round: null,
        history: history || [],
        scores: safeScores
      });
    }

    const [pos1, pos2] = await Promise.all([
      refreshPositions(round.ai1?.positions),
      refreshPositions(round.ai2?.positions)
    ]);

    // ✅ portfolioValue = 1000 + sum of all PNLs
    const totalPnL1 = pos1.reduce((s, p) => s + (p.pnl || 0), 0);
    const totalPnL2 = pos2.reduce((s, p) => s + (p.pnl || 0), 0);

    const val1 = Math.max(0, 1000 + totalPnL1);
    const val2 = Math.max(0, 1000 + totalPnL2);

    const ai1 = {
      ...round.ai1,
      positions: pos1,
      portfolioValue: +val1.toFixed(2),
      totalPnL: +totalPnL1.toFixed(2)
    };
    const ai2 = {
      ...round.ai2,
      positions: pos2,
      portfolioValue: +val2.toFixed(2),
      totalPnL: +totalPnL2.toFixed(2)
    };

    const timeLeft = Math.max(0, Math.floor((new Date(round.ends_at) - Date.now()) / 1000));

    return res.json({
      round: {
        ...round,
        ai1, ai2,
        time_left: timeLeft,
        time_left_min: Math.floor(timeLeft / 60),
        leading: val1 >= val2 ? 'ai1' : 'ai2'
      },
      history: (history || []).slice(0, 10),
      scores: safeScores
    });
  } catch (err) {
    console.error('state error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}