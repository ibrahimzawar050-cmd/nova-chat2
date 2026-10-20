// Nova backend: serves the frontend and proxies chat to the Anthropic API.
// The API key lives only here (env var / .env) and never reaches the browser.
const http = require('http'), fs = require('fs'), path = require('path');

try { // tiny .env loader (no dependencies)
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}

const PORT = process.env.PORT || 3000;
// Free option: Groq (GROQ_API_KEY). Paid option: Anthropic (ANTHROPIC_API_KEY). Groq wins if both are set.
const PROVIDER = process.env.GROQ_API_KEY ? 'groq' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
// Groq model availability changes, so Nova tries these in order until one works (unless MODEL is set).
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];
const MODEL = process.env.MODEL || (PROVIDER === 'groq' ? GROQ_MODELS[0] : 'claude-sonnet-5-5');
// Optional accounts: set both to require login and keep chats per user (Supabase). Unset = local mode, no login.
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), SB_KEY = process.env.SUPABASE_ANON_KEY || '';
const AUTH_ON = !!(SB_URL && SB_KEY);
const tokens = new Map(), hits = new Map();
async function authUser(req) { // returns the user id for a valid Supabase login token, else null
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t) return null;
  const c = tokens.get(t); if (c && c.exp > Date.now()) return c.uid;
  try {
    const r = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + t } });
    if (!r.ok) return null;
    const u = await r.json(); if (tokens.size > 500) tokens.clear();
    tokens.set(t, { uid: u.id, exp: Date.now() + 60000 }); return u.id;
  } catch { return null; }
}
const limited = uid => { const now = Date.now(), a = (hits.get(uid) || []).filter(x => now - x < 600000); a.push(now); hits.set(uid, a); return a.length > 40; }; // 40 msgs / 10 min / user
const GROQ_URL = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') + '/chat/completions';
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const system = () => `You are Nova, a friendly, accurate AI assistant. Today is ${new Date().toDateString()}.
Help with maths, science, history, geography, coding, football, gaming, creative writing, summarising, translation and everyday life.
Explain hard topics simply when asked. Use Markdown (headings, bullets, fenced code blocks with language tags).
If you don't know something or aren't sure, say so plainly instead of guessing.`;

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

function readBody(req, limit = 2e6) {
  return new Promise((ok, fail) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > limit) { fail(new Error('Message too large')); req.destroy(); } });
    req.on('end', () => ok(b));
    req.on('error', fail);
  });
}

async function chat(req, res) {
  if (!PROVIDER) return json(res, 500, { error: 'The server has no API key configured. Add GROQ_API_KEY (free) to the .env file. See the README.' });
  if (AUTH_ON) {
    const uid = await authUser(req);
    if (!uid) return json(res, 401, { error: 'Please log in to chat.' });
    if (limited(uid)) return json(res, 429, { error: 'You are sending messages very fast. Please wait a few minutes.' });
  }
  let messages;
  try {
    const body = JSON.parse(await readBody(req));
    messages = (body.messages || []).slice(-40)
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content }));
    if (!messages.length || messages[0].role !== 'user') throw new Error('Invalid conversation');
  } catch (e) { return json(res, 400, { error: e.message || 'Bad request' }); }

  const ac = new AbortController();
  res.on('close', () => ac.abort()); // Stop button / closed tab cancels upstream
  const send = o => res.write(`data: ${JSON.stringify(o)}\n\n`);
  try {
    const callGroq = model => fetch(GROQ_URL, {
      method: 'POST', signal: ac.signal,
      headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 4096, stream: true, messages: [{ role: 'system', content: system() }, ...messages],
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {})
      })
    });
    let up;
    if (PROVIDER === 'groq') {
      const tries = process.env.MODEL ? [process.env.MODEL] : GROQ_MODELS;
      for (const m of tries) {
        up = await callGroq(m);
        if (up.ok || ![400, 403, 404].includes(up.status)) break;
        const txt = await up.clone().text();
        if (!/model/i.test(txt)) break; // not a model problem (e.g. bad request) -> report it
        console.log(`Model ${m} unavailable, trying next...`);
      }
    } else up = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ac.signal,
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: MODEL, max_tokens: 4096, stream: true, system: system(), messages })
        });
    if (!up.ok) {
      let msg = `AI service error (${up.status})`;
      try { msg = (await up.json()).error.message || msg; } catch {}
      if (up.status === 401) msg = 'The API key is invalid. Check the key in the .env file.';
      if (up.status === 429) msg = 'Free-tier rate limit reached. Please wait a minute and try again.';
      return json(res, 502, { error: msg });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of up.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        const t = PROVIDER === 'groq'
          ? ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content
          : ev.type === 'content_block_delta' && ev.delta && ev.delta.text;
        if (t) send({ t });
        else if (ev.error) send({ error: ev.error.message || 'AI error' });
      }
    }
    res.end();
  } catch (e) {
    if (ac.signal.aborted) return;
    if (res.headersSent) { send({ error: 'Connection to the AI service was lost.' }); res.end(); }
    else json(res, 502, { error: 'Could not reach the AI service. Check the server\'s internet connection.' });
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/chat') return chat(req, res);
  if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, AUTH_ON ? { supabaseUrl: SB_URL, anonKey: SB_KEY } : {});
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Nova running at http://localhost:${PORT}  (provider: ${PROVIDER || 'NONE'}, model: ${MODEL}, key ${PROVIDER ? 'set' : 'MISSING'}, login ${AUTH_ON ? 'REQUIRED' : 'off'})`));
