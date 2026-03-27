import fs from 'fs';

const API_KEY = process.env.OPENROUTER_API_KEY || 'sk-or-v1-ВСТАВЬ_СВОЙ_КЛЮЧ';
const LEADERBOARD_FILE = './leaderboard.json';

const PORTFOLIO = [
  'BTC', 'ETH', 'SOL', 'HYPE', 'BNB',
  'XRP', 'DOGE', 'ADA', 'AVAX', 'ARB',
  'OP', 'SUI', 'APT', 'INJ', 'TIA'
];

const MODELS = [
  { id: 'x-ai/grok-3-mini-beta',                    name: 'Grok 3 Mini' },
  { id: 'google/gemini-2.0-flash-001',               name: 'Gemini 2.0 Flash' },
  { id: 'anthropic/claude-3-5-haiku',                name: 'Claude 3.5 Haiku' },
  { id: 'openai/gpt-4o-mini',                        name: 'GPT-4o Mini' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small' }
];

const TOPIC_TEMPLATES = [
  c => `${c} will 10x by end of 2026`,
  c => `${c} is the best crypto investment right now`,
  c => `${c} is overvalued and will dump 80%`,
  c => `${c} will flip its biggest competitor`,
  c => `${c} is dead and has no future`,
  c => `${c} will be top 3 crypto by market cap`
];

// ─── HELPERS ──────────────────────────────────────────────

function loadLB() {
  try { return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8')); }
  catch { return { battles: [], scores: {}, totalBattles: 0 }; }
}

function saveLB(data) {
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(data, null, 2));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickTwo(arr) {
  const a = pickRandom(arr);
  let b;
  do { b = pickRandom(arr); } while (b.id === a.id);
  return [a, b];
}

// ─── AI CALL ──────────────────────────────────────────────

async function callAI(modelId, stance, topic) {
  const prompt = stance === 'BULL'
    ? `You are an aggressive crypto bull trader. Make the strongest BULLISH case for: "${topic}". Max 3 punchy sentences. Use real numbers/data. No disclaimers.`
    : `You are an aggressive crypto bear trader. Make the strongest BEARISH case for: "${topic}". Max 3 punchy sentences. Use real numbers/data. No disclaimers.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ai-deathmatch.vercel.app',
        'X-Title': 'AI Deathmatch Agent'
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.95
      })
    });

    const data = await res.json();
    if (data.error) return `[API Error: ${data.error.message}]`;
    return data.choices?.[0]?.message?.content?.trim() || '[No response]';
  } catch (e) {
    return `[Connection error: ${e.message}]`;
  }
}

// ─── BATTLE ───────────────────────────────────────────────

async function runBattle() {
  const coin  = pickRandom(PORTFOLIO);
  const topic = pickRandom(TOPIC_TEMPLATES)(coin);
  const [m1, m2] = pickTwo(MODELS);

  console.log(`\n⚔️  ${topic}`);
  console.log(`🟢 BULL: ${m1.name}  vs  🔴 BEAR: ${m2.name}`);

  const [bullText, bearText] = await Promise.all([
    callAI(m1.id, 'BULL', topic),
    callAI(m2.id, 'BEAR', topic)
  ]);

  const battle = {
    id: Date.now(),
    coin,
    topic,
    timestamp: new Date().toISOString(),
    fighter1: { model: m1.id, name: m1.name, stance: 'BULL', text: bullText },
    fighter2: { model: m2.id, name: m2.name, stance: 'BEAR', text: bearText },
    winner: null
  };

  const lb = loadLB();
  lb.battles.unshift(battle);
  if (lb.battles.length > 100) lb.battles = lb.battles.slice(0, 100);
  lb.totalBattles = (lb.totalBattles || 0) + 1;
  saveLB(lb);

  console.log(`✅ Saved. Total battles: ${lb.totalBattles}`);
  console.log(`🟢 Bull: ${bullText.substring(0, 80)}...`);
  console.log(`🔴 Bear: ${bearText.substring(0, 80)}...`);

  return battle;
}

// ─── VOTE (called from server) ────────────────────────────

export function recordVote(battleId, winner) {
  const lb = loadLB();
  const battle = lb.battles.find(b => b.id === Number(battleId));
  if (!battle || battle.winner) return false;

  battle.winner = winner;
  const modelName = winner === 1
    ? (battle.fighter1.name || battle.fighter1.model.split('/')[1])
    : (battle.fighter2.name || battle.fighter2.model.split('/')[1]);

  lb.scores[modelName] = (lb.scores[modelName] || 0) + 1;
  saveLB(lb);
  return modelName;
}

// ─── MAIN LOOP ────────────────────────────────────────────

async function start() {
  const intervalSec = parseInt(process.argv[2]) || 60;
  console.log('🤖 AI DEATHMATCH AGENT STARTED');
  console.log(`📊 Portfolio: ${PORTFOLIO.join(', ')}`);
  console.log(`⏱️  New battle every ${intervalSec} seconds\n`);

  await runBattle();
  setInterval(runBattle, intervalSec * 1000);
}

start();