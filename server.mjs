import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENROUTER_API_KEY || 'sk-or-v1-ВСТАВЬ_СВОЙ_КЛЮЧ';
const LEADERBOARD_FILE = './leaderboard.json';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── helpers ──────────────────────────────────────────────

function loadLB() {
  try { return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8')); }
  catch { return { battles: [], scores: {}, totalBattles: 0 }; }
}

function saveLB(data) {
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(data, null, 2));
}

async function callAI(model, stance, topic) {
  const prompt = stance === 'BULL'
    ? `You are an aggressive crypto bull. Make the strongest BULLISH case for: "${topic}". Max 3 punchy sentences. No disclaimers.`
    : `You are an aggressive crypto bear. Make the strongest BEARISH case for: "${topic}". Max 3 punchy sentences. No disclaimers.`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'AI Deathmatch'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250,
      temperature: 0.95
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content?.trim() || 'No response';
}

// ─── API ROUTES ───────────────────────────────────────────

// Manual battle trigger
app.post('/api/battle', async (req, res) => {
  const { topic, model1, model2 } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic required' });

  try {
    const [r1, r2] = await Promise.all([
      callAI(model1 || 'x-ai/grok-3-mini-beta', 'BULL', topic),
      callAI(model2 || 'google/gemini-2.0-flash-001', 'BEAR', topic)
    ]);

    const battle = {
      id: Date.now(),
      topic,
      timestamp: new Date().toISOString(),
      fighter1: { model: model1, name: model1?.split('/')[1], stance: 'BULL', text: r1 },
      fighter2: { model: model2, name: model2?.split('/')[1], stance: 'BEAR', text: r2 },
      winner: null
    };

    const lb = loadLB();
    lb.battles.unshift(battle);
    if (lb.battles.length > 100) lb.battles = lb.battles.slice(0, 100);
    lb.totalBattles = (lb.totalBattles || 0) + 1;
    saveLB(lb);

    res.json(battle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
  res.json(loadLB());
});

// Submit vote
app.post('/api/vote', (req, res) => {
  const { battleId, winner } = req.body;
  const lb = loadLB();
  const battle = lb.battles.find(b => b.id === Number(battleId));

  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (battle.winner) return res.status(400).json({ error: 'Already voted' });

  battle.winner = winner;
  const modelName = winner === 1
    ? (battle.fighter1.name || battle.fighter1.model?.split('/')[1])
    : (battle.fighter2.name || battle.fighter2.model?.split('/')[1]);

  lb.scores[modelName] = (lb.scores[modelName] || 0) + 1;
  saveLB(lb);

  res.json({ winner: modelName, scores: lb.scores });
});

// ─── START ────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 AI DEATHMATCH running at http://localhost:${PORT}`);
  console.log(`📊 Leaderboard: http://localhost:${PORT}/api/leaderboard\n`);
});