export const config = { maxDuration: 20 };

const GROQ_KEY    = process.env.GROQ_API_KEY;
const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOK = process.env.KV_REST_API_TOKEN;
const GAMMA       = 'https://gamma-api.polymarket.com';

async function dbGet(key) {
  if (!UPSTASH_URL) return null;
  try {
    const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`,
      { headers:{ Authorization:`Bearer ${UPSTASH_TOK}` }});
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}
async function dbSet(key, value) {
  if (!UPSTASH_URL) return;
  try {
    await fetch(
      `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`,
      { headers:{ Authorization:`Bearer ${UPSTASH_TOK}` }}
    );
  } catch {}
}

// Обновляем цены с Polymarket
async function refreshPrice(pos) {
  if (pos.isSimulated || !pos.tokenId) {
    const noise = (Math.random()-.5)*0.04;
    const cp    = Math.max(.01, Math.min(.99, pos.currentPrice+noise));
    return { ...pos, currentPrice:+cp.toFixed(4), currentValue:+(pos.shares*cp).toFixed(2), pnl:+(pos.shares*cp-pos.allocation).toFixed(2) };
  }
  try {
    const r  = await Promise.race([
      fetch(`https://clob.polymarket.com/midpoint?token_id=${pos.tokenId}`).then(r=>r.json()),
      new Promise(r=>setTimeout(()=>r({mid:null}),2000))
    ]);
    const cp = Math.max(.01, Math.min(.99, parseFloat(r.mid||pos.currentPrice)));
    return { ...pos, currentPrice:+cp.toFixed(4), currentValue:+(pos.shares*cp).toFixed(2), pnl:+(pos.shares*cp-pos.allocation).toFixed(2) };
  } catch { return pos; }
}

async function rebalanceBot(bot) {
const RISK_RULES = {
  gambler:      'You are a GAMBLER. NEVER sell early. Hold everything to the end. The only reason to rebalance: add more to a winning position.',
  disciplined:  'You are DISCIPLINED. Sell if PnL < -15% (cut loss) or > +25% (take profit). Strict rules, no emotions.',
  intuitive:    'You follow INTUITION. Sell if the underlying narrative has changed. Otherwise hold. Trust your gut.',
  contrarian:   'You are CONTRARIAN. If a position is strongly winning (+20%), that means the crowd agrees with you now — EXIT. If losing, hold or add.',
  momentum:     'You ride MOMENTUM. Hold as long as price direction is unchanged. Sell only if momentum reverses (was going up, now going down).',
  patient:      'You are PATIENT. Hold all positions until expiry unless a position has completely failed (> -40%). Time is your friend.'
};

const rule = RISK_RULES[bot.riskProfile] || RISK_RULES.intuitive;

const prompt = `You are ${bot.name} ${bot.emoji}.

YOUR RULE: ${rule}

Portfolio: $${totalValue.toFixed(2)} | PnL: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}

POSITIONS:
${positions.map(p => {
  const move  = p.entryPrice > 0 ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(1) : '0';
  const arrow = parseFloat(move) > 0 ? '↑' : parseFloat(move) < 0 ? '↓' : '→';
  const levTag = p.leverage > 1 ? ` [${p.leverage}x LEVERAGE]` : '';
  return `"${p.marketTitle.slice(0,55)}" | ${p.optionName}${levTag} | entry:${(p.entryPrice*100).toFixed(0)}¢ now:${(p.currentPrice*100).toFixed(0)}¢ ${arrow}${Math.abs(move)}% | PnL:${p.pnl>=0?'+':''}$${(p.pnl||0).toFixed(2)}`;
}).join('\n')}

Based on YOUR RULE above — decide: HOLD everything, or REBALANCE?
Stay in character. Be honest about your reasoning.

Return ONLY JSON:
{"decision":"HOLD","thought":"honest one sentence in character","sell":[],"buy":[]}`;

  try {
    const resp = await Promise.race([
      fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{'Authorization':`Bearer ${GROQ_KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify({model:bot.model||'mixtral-8x7b-32768',
          messages:[{role:'user',content:prompt}],max_tokens:400,temperature:1.0})
      }).then(r=>r.json()),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))
    ]);

    const text  = resp.choices?.[0]?.message?.content||'';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { ...bot, positions, portfolioValue:+totalValue.toFixed(2), totalPnL, last_thought:'...' };

    const d = JSON.parse(match[0]);
    let updatedPositions = [...positions];

    if (d.decision==='REBALANCE') {
      // Продаём
      for (const title of (d.sell||[])) {
        updatedPositions = updatedPositions.filter(p=>
          !p.marketTitle?.toLowerCase().includes(title.toLowerCase().slice(0,25))
        );
      }
      // Покупаем новое
      for (const buy of (d.buy||[])) {
        // Пробуем найти на Polymarket
        let tokenId = null;
        try {
          const search = await Promise.race([
            fetch(`${GAMMA}/markets?active=true&limit=3&q=${encodeURIComponent(buy.title.slice(0,30))}`).then(r=>r.json()),
            new Promise(r=>setTimeout(()=>r([]),2000))
          ]);
          const arr = Array.isArray(search) ? search : (search.markets||[]);
          if (arr[0]) {
            const optIdx  = buy.option?.toLowerCase()==='no'?1:0;
            tokenId = arr[0].clobTokenIds?.[optIdx]||null;
          }
        } catch {}

        const cp = Math.max(.01, Math.min(.99, parseFloat(buy.price||.5)));
        updatedPositions.push({
          marketId:     `rb-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
          marketTitle:  buy.title,
          tokenId,
          optionIndex:  buy.option?.toLowerCase()==='no'?1:0,
          optionName:   buy.option||'Yes',
          allocation:   Math.min(400, parseInt(buy.allocation)||200),
          entryPrice:   cp,
          currentPrice: cp,
          shares:       +((parseInt(buy.allocation)||200)/cp).toFixed(4),
          pnl:          0,
          isSimulated:  !tokenId,
          reasoning:    'rebalance decision'
        });
      }
    }

    const newTotal = updatedPositions.reduce((s,p)=>s+(p.currentValue||p.allocation),0);
    return {
      ...bot,
      positions:     updatedPositions,
      portfolioValue: +newTotal.toFixed(2),
      totalPnL:       +(newTotal-1000).toFixed(2),
      last_thought:   d.thought||'',
      last_decision:  d.decision||'HOLD',
      last_rebalance: new Date().toISOString()
    };
  } catch(e) {
    console.log('rebalance AI err:',e.message);
    return { ...bot, positions, portfolioValue:+totalValue.toFixed(2), totalPnL };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  try {
    // ── РАНДОМНЫЙ ИНТЕРВАЛ 10-30 МИН ─────────────────────
    const schedule = await dbGet('rebalance_schedule') || {};
    const now      = Date.now();
    if (schedule.next_at && now < schedule.next_at) {
      const waitMin = Math.round((schedule.next_at - now) / 60000);
      return res.json({ ok:false, reason:`next rebalance in ${waitMin} min` });
    }
    // Устанавливаем следующее время рандомно 10-30 мин
    const nextMin = 10 + Math.floor(Math.random()*20);
    await dbSet('rebalance_schedule', { next_at: now + nextMin*60000, interval_min: nextMin });

    const round = await dbGet('round');
    if (!round?.ai1) return res.json({ ok:false, reason:'no active round' });

    const timeLeft = (new Date(round.ends_at) - now) / 60000;
    if (timeLeft < 4) return res.json({ ok:false, reason:'round ending in <4 min, skipping' });

    console.log(`Rebalancing | ${round.ai1.name} & ${round.ai2.name} | ${timeLeft.toFixed(0)} min left | next in ${nextMin} min`);
    const [ai1, ai2] = await Promise.all([rebalanceBot(round.ai1), rebalanceBot(round.ai2)]);

    await dbSet('round', { ...round, ai1, ai2 });
    return res.json({
      ok:true, next_rebalance_in_min: nextMin,
      ai1: { decision:ai1.last_decision, thought:ai1.last_thought, value:ai1.portfolioValue },
      ai2: { decision:ai2.last_decision, thought:ai2.last_thought, value:ai2.portfolioValue }
    });
  } catch(err) {
    return res.status(500).json({ error:err.message });
  }
}