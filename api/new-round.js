export const config = { maxDuration: 25 };

const GROQ_KEY = process.env.GROQ_API_KEY;
const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOK = process.env.KV_REST_API_TOKEN;

// ─── STORAGE ──────────────────────────────────────────────
async function dbGet(key) {
  if (!UPSTASH_URL) return null;
  try {
    const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${UPSTASH_TOK}` } });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch { return null; }
}

async function dbSet(key, value) {
  if (!UPSTASH_URL) return;
  try {
    await fetch(
      `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`,
      { headers: { Authorization: `Bearer ${UPSTASH_TOK}` } }
    );
  } catch {}
}

// ─── GAMMA API ────────────────────────────────────────────
const GAMMA = 'https://gamma-api.polymarket.com';

async function fetchCategory(tag, limit = 10) {
  try {
    const url = `${GAMMA}/markets?active=true&closed=false&tag_slug=${tag}&limit=${limit}&sort_by=volume24h&ascending=false`;
    const r = await Promise.race([
      fetch(url, { headers: { Accept: 'application/json' } }),
      new Promise((_,rej) => setTimeout(() => rej(new Error('timeout')), 5000))
    ]);
    const data = await r.json();
    return Array.isArray(data) ? data : (data.markets || data.data || []);
  } catch (e) {
    console.log(`fetchCategory ${tag} error:`, e.message);
    return [];
  }
}

async function fetchTopVolume(limit = 15) {
  try {
    const url = `${GAMMA}/markets?active=true&closed=false&limit=${limit}&sort_by=volume24h&ascending=false`;
    const r = await Promise.race([
      fetch(url, { headers: { Accept: 'application/json' } }),
      new Promise((_,rej) => setTimeout(() => rej(new Error('timeout')), 5000))
    ]);
    const data = await r.json();
    return Array.isArray(data) ? data : (data.markets || data.data || []);
  } catch (e) {
    console.log('fetchTopVolume error:', e.message);
    return [];
  }
}

function parseGammaMarket(m) {
  if (!m) return null;

  let outcomes = m.outcomes || ['Yes','No'];
  if (typeof outcomes === 'string') {
    try { outcomes = JSON.parse(outcomes); } catch { outcomes = ['Yes','No']; }
  }
  if (!Array.isArray(outcomes)) outcomes = ['Yes','No'];

  let tokenIds = m.clobTokenIds || m.clob_token_ids || [];
  if (typeof tokenIds === 'string') {
    try { tokenIds = JSON.parse(tokenIds); } catch { tokenIds = []; }
  }

  let outcomePrices = m.outcomePrices || [];
  if (typeof outcomePrices === 'string') {
    try { outcomePrices = JSON.parse(outcomePrices); } catch { outcomePrices = []; }
  }

  const prices = outcomes.map((outcome, i) => {
    const rawPrice = outcomePrices[i] ? parseFloat(outcomePrices[i]) : 0.5;
    const cp = Math.max(0.01, Math.min(0.99, rawPrice));
    return {
      choiceIndex: i,
      optionName: String(outcome),
      currentPrice: BigInt(Math.round(cp * 1e18)),
      tokenId: tokenIds[i] || null,
      priceFloat: cp
    };
  });

  return {
    id: m.conditionId || m.id || m.condition_id,
    title: m.question || m.title || m.name,
    category: m.category || m.tags?.[0]?.slug || m.tag || 'general',
    volume24h: parseFloat(m.volume24hr || m.volumeNum || m.volume || 0),
    prices,
    tokens: outcomes.map((o, i) => ({
      token_id: tokenIds[i] || null,
      outcome: String(o)
    }))
  };
}

async function getMarkets() {
  const [crypto, politics, sports, trending] = await Promise.all([
    fetchCategory('crypto', 15),
    fetchCategory('politics', 15),
    fetchCategory('sports', 15),
    fetchTopVolume(10)
  ]);

  console.log(`Gamma: crypto=${crypto.length} politics=${politics.length} sports=${sports.length} trending=${trending.length}`);

  const seen = new Set();
  const all = [...trending, ...crypto, ...politics, ...sports]
    .map(parseGammaMarket)
    .filter(m => {
      if (!m?.id || !m?.title || m.title === 'Unknown') return false;
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    })
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
    .slice(0, 45);

  console.log(`Final markets pool: ${all.length}`);
  if (all.length > 0) return { markets: all, source: 'polymarket' };
  return { markets: getSimMarkets(), source: 'simulated' };
}

// ─── БОТЫ ─────────────────────────────────────────────────
const BOTS = [
  { id:'llama-3.3-70b-versatile', name:'NARRATIVE CHASER 📰', emoji:'📰', color:'#a855f7',
    style:`Follow hottest narratives on crypto Twitter and news.
Pick markets matching trending topics. Be directional — LONG hot narratives, SHORT dying ones.
Mix categories: crypto + politics + macro.` },

  { id:'mixtral-8x7b-32768', name:'CONTRARIAN SHARK 🦈', emoji:'🦈', color:'#ef4444',
    style:`Always fade the crowd.
If YES > 65%: buy NO (crowded trade). If YES < 30%: buy YES (underpriced).
At least 3 of 4 picks must go against consensus.` },

  { id:'llama-3.1-8b-instant', name:'MOMENTUM RIDER 🚀', emoji:'🚀', color:'#22c55e',
    style:`Pure momentum. Always bet on the LEADING option (higher price).
Prefer high-volume markets. Never fight the trend.
Concentrated portfolio, 3 picks max.` },

  { id:'gemma2-9b-it', name:'DEGEN APE 🦍', emoji:'🦍', color:'#ff6b00',
    style:`Maximum degen. ONLY pick longshots priced UNDER 20%.
Moonshot only. 2-3 concentrated bets. Go big or go home.
Sports upsets, crypto 10x, political wildcards preferred.` },

  { id:'llama-3.3-70b-versatile', name:'REVERSAL HUNTER 🔄', emoji:'🔄', color:'#f59e0b',
    style:`Catch mean reversion. Find options above 75% or below 20% — bet opposite.
Everything reverts to 50/50. The more extreme, the stronger the signal.` },

  { id:'mixtral-8x7b-32768', name:'QUANT MACHINE 🤖', emoji:'🤖', color:'#00aaff',
    style:`Statistical diversification across 4-5 markets.
One pick per category (crypto, politics, sports, macro).
Target 40-60% probability options — that's where mispricings live.` },
];

// ─── BUILD PORTFOLIO ──────────────────────────────────────
async function buildPortfolio(bot, markets) {
  const list = markets.slice(0,15).map((m,i) => {
    const opts = (m.prices||[]).map(p =>
      `${p.optionName||`Opt${p.choiceIndex}`}@${p.priceFloat?.toFixed(2)||(Number(p.currentPrice)/1e18).toFixed(2)}`
    ).join(' | ');
    const vol = m.volume24h ? ` [vol:$${(m.volume24h/1000).toFixed(0)}k]` : '';
    return `[${i}] [${m.category||'?'}] "${m.title}"${vol} — ${opts}`;
  }).join('\n');

  const prompt = `You are ${bot.name}.
${bot.style}

LIVE POLYMARKET PREDICTION MARKETS (with categories and 24h volume):
${list}

Budget: $1000. Pick 3-4 positions.
- marketIndex: 0 to ${Math.min(14, markets.length-1)}
- optionIndex: 0 or 1
- allocation: $150-$400, total ≤ $1000
- leverage: 1 to 5 (integer or float, e.g. 2.5)

Return ONLY JSON:
{"strategy":"punchy one-liner max 15 words","picks":[{"marketIndex":0,"optionIndex":0,"allocation":300,"leverage":2,"reasoning":"3-5 words"}]}`;

  let strategy = `${bot.name} enters the arena`;
  let picks = [];

  if (GROQ_KEY) {
    try {
      const resp = await Promise.race([
        fetch('https://api.groq.com/openai/v1/chat/completions', {
          method:'POST',
          headers:{ 'Authorization':`Bearer ${GROQ_KEY}`, 'Content-Type':'application/json' },
          body: JSON.stringify({
            model: bot.id,
            messages:[{role:'user',content:prompt}],
            max_tokens:350, temperature:0.95
          })
        }).then(r=>r.json()),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))
      ]);
      if (!resp.error) {
        const text = resp.choices?.[0]?.message?.content||'';
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const p = JSON.parse(match[0]);
          strategy = p.strategy || strategy;
          picks = p.picks || [];
        }
      }
    } catch(e) { console.log('Groq:', e.message); }
  }

  if (!picks.length) {
    const count = bot.name.includes('QUANT') ? 4 : bot.name.includes('DEGEN') ? 2 : 3;
    const idxs = [...Array(Math.min(15,markets.length)).keys()].sort(()=>Math.random()-.5).slice(0,count);
    picks = idxs.map(i => {
      const m = markets[i];
      const yes = m.prices?.[0]?.priceFloat ?? .5;
      let opt = Math.random()>.5?0:1;
      if (bot.name.includes('CONTRARIAN')) opt = yes>.5?1:0;
      if (bot.name.includes('DEGEN')) opt = yes<.25?0:(yes>.75?1:1);
      if (bot.name.includes('MOMENTUM')) opt = yes>.5?0:1;
      if (bot.name.includes('REVERSAL')) opt = yes>.65?1:(yes<.35?0:Math.random()>.5?0:1);
      return {
        marketIndex: i,
        optionIndex: opt,
        allocation: 180 + Math.floor(Math.random()*150),
        leverage: parseFloat((1 + Math.random()*4).toFixed(1)) // 1-5x fallback
      };
    });
  }

  const positions = picks.map(pick => {
    const m = markets[parseInt(pick.marketIndex)];
    if (!m?.id) return null;
    const oIdx = parseInt(pick.optionIndex)||0;
    const po = (m.prices||[]).find(p=>p.choiceIndex===oIdx)||(m.prices||[])[0];
    const cp = Math.max(.01, Math.min(.99, po?.priceFloat ?? (po?.currentPrice ? Number(po.currentPrice)/1e18 : .5)));
    const margin = Math.max(100, Math.min(400, parseInt(pick.allocation)||250));

    // ✅ PERP-STYLE LEVERAGE: margin × leverage = positionSize → shares
    const leverage = Math.max(1, Math.min(5, parseFloat(pick.leverage) || 1));
    const positionSize = margin * leverage;
    const shares = parseFloat((positionSize / cp).toFixed(4));

    return {
      marketId: m.id,
      marketTitle: m.title||'Unknown',
      category: m.category||'general',
      tokenId: po?.tokenId || m.tokens?.[oIdx]?.token_id || null,
      optionIndex: oIdx,
      optionName: po?.optionName||(oIdx===0?'Yes':'No'),
      allocation: margin,       // margin (что реально потратил)
      leverage,                 // 1-5x
      positionSize,             // margin × leverage (размер позиции)
      entryPrice: +cp.toFixed(4),
      currentPrice: +cp.toFixed(4),
      shares,                   // positionSize / entryPrice
      pnl: 0,
      isSimulated: m.id.startsWith('s'),
      reasoning: pick.reasoning||''
    };
  }).filter(Boolean);

  return { strategy, positions };
}

// ─── SETTLE ───────────────────────────────────────────────
async function settle(prev) {
  const scores = await dbGet('scores') || { ai1:0, ai2:0, rounds:0 };
  const history = await dbGet('history') || [];

  // ✅ ПРАВИЛЬНЫЙ PNL: (currentPrice - entryPrice) × shares
  // shares уже учитывают leverage (positionSize / entryPrice)
  // Entry=Now → PNL=0 ✅
  function calcPortfolioValue(bot) {
    const totalPnL = (bot.positions||[]).reduce((s, p) => {
      const priceDiff = p.currentPrice - p.entryPrice;
      const pnl = priceDiff * p.shares;
      return s + pnl;
    }, 0);
    return Math.max(0, 1000 + totalPnL);
  }

  function calcValue(bot) {
  const pnl = (bot.positions||[]).reduce((s,p) => s + (p.currentPrice - p.entryPrice) * p.shares, 0);
  return Math.max(0, 1000 + pnl);
}
const v1 = +calcValue(prev.ai1).toFixed(2);
const v2 = +calcValue(prev.ai2).toFixed(2);
  const winner = v1 >= v2 ? 1 : 2;

  scores.rounds++;
  if (winner===1) scores.ai1++; else scores.ai2++;

  history.unshift({
    round_num: prev.round_num,
    started_at: prev.started_at,
    settled_at: new Date().toISOString(),
    ai1_name: prev.ai1.name, ai1_value: v1,
    ai2_name: prev.ai2.name, ai2_value: v2,
    winner, source: prev.data_source||'simulated'
  });
  if (history.length>50) history.length=50;
  await Promise.all([dbSet('history',history), dbSet('scores',scores)]);
}

// ─── MAIN ─────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  try {
    const prev = await dbGet('round');
    if (prev?.ai1?.positions?.length) {
      try { await settle(prev); } catch(e) { console.log('settle:',e.message); }
    }

    const scores = await dbGet('scores')||{rounds:0};
    const roundNum = (scores.rounds||0)+1;

    const shuffled = [...BOTS].sort(()=>Math.random()-.5);
    const b1=shuffled[0], b2=shuffled[1];

    const { markets, source } = await getMarkets();
    const [p1,p2] = await Promise.all([buildPortfolio(b1,markets), buildPortfolio(b2,markets)]);

    const round = {
      id: Date.now(), round_num: roundNum,
      started_at: new Date().toISOString(),
      ends_at: new Date(Date.now()+30*60*1000).toISOString(),
      matchup: `${b1.name} vs ${b2.name}`,
      data_source: source,
      markets_count: markets.length,
      bettingMarketId: null,
      bettingMarketAddress: null,
      ai1: { name:b1.name, emoji:b1.emoji, color:b1.color, model:b1.id, strategy:p1.strategy, positions:p1.positions },
      ai2: { name:b2.name, emoji:b2.emoji, color:b2.color, model:b2.id, strategy:p2.strategy, positions:p2.positions }
    };

    await dbSet('round', round);
    console.log(`Round #${roundNum}: ${b1.name} vs ${b2.name} | ${source} | ${markets.length} markets`);

    return res.status(200).json({
      ok:true, round_num:roundNum, matchup:round.matchup,
      data_source:source, markets_loaded:markets.length, ends_at:round.ends_at
    });
  } catch(err) {
    console.error('CRASH:',err.message);
    return res.status(500).json({ error:err.message });
  }
}