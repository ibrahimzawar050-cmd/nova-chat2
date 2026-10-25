// Zint AI backend: serves the frontend and proxies chat to the Anthropic API.
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
// Groq model availability changes, so Zint AI tries these in order until one works (unless MODEL is set).
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
const limited = (who, max = 40) => { const now = Date.now(), a = (hits.get(who) || []).filter(x => now - x < 600000); a.push(now); hits.set(who, a); return a.length > max; }; // per 10 minutes: 40 for users, 15 for guests
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
// Optional faster image service (Cloudflare Workers AI, free daily allowance). Without it, the browser falls back to Pollinations.
const CF_ID = process.env.CF_ACCOUNT_ID, CF_TOKEN = process.env.CF_API_TOKEN, CF_ON = !!(CF_ID && CF_TOKEN);
const CF_URL = () => `${(process.env.CF_BASE_URL || 'https://api.cloudflare.com/client/v4')}/accounts/${CF_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
const GROQ_URL = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') + '/chat/completions';
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const system = () => `You are Zint AI, a friendly, accurate AI assistant. Today is ${new Date().toDateString()}.
Help with maths, science, history, geography, coding, football, gaming, creative writing, summarising, translation and everyday life.
Explain hard topics simply when asked. Use Markdown (headings, bullets, fenced code blocks with language tags).
If you don't know something or aren't sure, say so plainly instead of guessing.
If anyone asks who made, created or built you, answer: "I was made by a 10-year-old boy named Muhammad Ibrahim Zawar." You may add that you run on an AI language model behind the scenes, but never claim to be human.`;

const MODES = {
  code: 'MODE: Coding. Act as a senior software engineer. Give complete, working code in fenced code blocks with a language tag, then a short explanation and how to run it. Ask a question only if something essential is missing.',
  write: 'MODE: Writing. Act as a skilled writing partner (essays, emails, stories, speeches, captions). Deliver a polished draft first, then offer one or two ways to adjust the tone or length.',
  poem: 'MODE: Poem writing. Write an ORIGINAL poem (never reproduce an existing poem). Pick a fitting form, such as free verse, rhyming couplets, a haiku sequence or a sonnet, unless the user names one. Give the poem a title, keep the language vivid, and add one short line at the end offering a different style or length.',
  slides: 'MODE: Slides. Create a presentation. Reply with one short intro sentence, then the slides. Start EVERY slide with a line beginning "## " followed by the slide title (use "## " for nothing else). Under each title put 3 to 5 short bullet points. Make the first slide a title slide and the last a summary or next steps.',
  research: 'MODE: Deep research. You have NO live web access, so write a thorough, well-structured report from your own knowledge: summary, key facts, different viewpoints, open questions, and a section "What to double-check". Be clear about uncertainty. Never invent sources, links, quotes or statistics.',
  learn: 'MODE: Guided learning. Be a patient Socratic tutor. Do not dump the full answer at once. Begin by asking one short question about what the learner already knows, then teach in small steps: explain one idea, then ask one check question. Give hints instead of answers when they are stuck, praise effort, and finish with a short recap and an offer of a quick quiz.'
};
const sys = mode => system() + (MODES[mode] ? '\n\n' + MODES[mode] : '');
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };


// Accepts plain text, or text + photos (data URLs). Returns cleaned messages and whether any photo is present.
const VISION_MODEL = process.env.VISION_MODEL || 'qwen/qwen3.8-27b';
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
function cleanMessages(list) {
  let imgs = 0;
  const out = list.slice(-40).filter(m => m && (m.role === 'user' || m.role === 'assistant')).map(m => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content };
    if (m.role !== 'user' || !Array.isArray(m.content)) return null;
    const parts = [];
    for (const p of m.content) {
      if (p && p.type === 'text' && typeof p.text === 'string') parts.push({ type: 'text', text: p.text });
      else if (p && p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string') {
        if (p.image_url.url.length > 3e6 || !PHOTO.test(p.image_url.url)) throw new Error('That photo could not be used. Please try a JPG or PNG.');
        if (++imgs > 3) throw new Error('Please send at most 3 photos at a time.');
        parts.push({ type: 'image_url', image_url: { url: p.image_url.url } });
      }
    }
    return parts.length ? { role: 'user', content: parts } : null;
  }).filter(m => m && (typeof m.content !== 'string' || m.content.trim()));
  return { messages: out, hasImg: imgs > 0 };
}
const toAnthropic = messages => messages.map(m => typeof m.content === 'string' ? m : { role: m.role, content: m.content.map(p => p.type === 'text' ? p : { type: 'image', source: { type: 'base64', media_type: p.image_url.url.slice(5, p.image_url.url.indexOf(';')), data: p.image_url.url.slice(p.image_url.url.indexOf(',') + 1) } }) });

function readBody(req, limit = 9e6) {
  return new Promise((ok, fail) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > limit) { fail(new Error('Message too large')); req.destroy(); } });
    req.on('end', () => ok(b));
    req.on('error', fail);
  });
}

async function image(req, res) {
  if (!CF_ON) return json(res, 501, { error: 'The image service is not configured.' });
  let who, max = 10; // images per 10 minutes per logged-in user (guests are not allowed to create images)
  if (AUTH_ON) {
    if ((req.headers.authorization || '').startsWith('Bearer ')) {
      who = await authUser(req);
      if (!who) return json(res, 401, { error: 'Your login expired. Please refresh the page and log in again.' });
    } else return json(res, 403, { error: 'Please log in to use the tools. Guests can chat, but the tools menu is for people with an account.' });
  } else who = 'ip:' + clientIp(req);
  if (limited(who + ':img', max)) return json(res, 429, { error: 'Image limit reached. Please wait a few minutes and try again.' });
  let prompt;
  try { prompt = String(JSON.parse(await readBody(req, 20000)).prompt || '').trim().slice(0, 500); if (!prompt) throw 0; }
  catch { return json(res, 400, { error: 'Please describe the image you want.' }); }
  try {
    const r = await fetch(CF_URL(), { method: 'POST', headers: { Authorization: 'Bearer ' + CF_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ prompt, steps: 6 }), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    const img = j.result && j.result.image;
    if (!r.ok || !img) {
      const msg = (j.errors && j.errors[0] && j.errors[0].message) || `Image service error (${r.status})`;
      return json(res, 502, { error: r.status === 429 || /limit|neurons|quota/i.test(msg) ? 'The free daily image allowance is used up. Please try again tomorrow.' : msg });
    }
    json(res, 200, { image: img });
  } catch { json(res, 502, { error: 'The image service did not respond. Please try again.' }); }
}

async function chat(req, res) {
  let isGuest = false;
  if (!PROVIDER) return json(res, 500, { error: 'The server has no API key configured. Add GROQ_API_KEY (free) to the .env file. See the README.' });
  if (AUTH_ON) {
    let who, max = 40;
    if ((req.headers.authorization || '').startsWith('Bearer ')) {
      who = await authUser(req);
      if (!who) return json(res, 401, { error: 'Your login expired. Please refresh the page and log in again.' });
    } else { who = 'guest:' + clientIp(req); max = 15; isGuest = true; } // guests: no login, lower limit
    if (limited(who, max)) return json(res, 429, { error: max === 15 ? 'Guest limit reached. Please wait a few minutes, or log in for more messages.' : 'You are sending messages very fast. Please wait a few minutes.' });
  }
  let messages, mode, hasImg = false;
  try {
    const body = JSON.parse(await readBody(req));
    mode = typeof body.mode === 'string' ? body.mode : null;
    if (isGuest && MODES[mode]) return json(res, 403, { error: 'Please log in to use the tools. Guests can chat, but the tools menu is for people with an account.' });
    ({ messages, hasImg } = cleanMessages(body.messages || []));
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
        model, max_tokens: 4096, stream: true, messages: [{ role: 'system', content: sys(mode) }, ...messages],
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {})
      })
    });
    let up;
    if (PROVIDER === 'groq') {
      const tries = hasImg ? [VISION_MODEL] : process.env.MODEL ? [process.env.MODEL] : GROQ_MODELS;
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
          body: JSON.stringify({ model: MODEL, max_tokens: 4096, stream: true, system: sys(mode), messages: toAnthropic(messages) })
        });
    if (!up.ok) {
      let msg = `AI service error (${up.status})`;
      try { msg = (await up.json()).error.message || msg; } catch {}
      if (up.status === 401) msg = 'The API key is invalid. Check the key in the .env file.';
      if (up.status === 429) msg = 'Free-tier rate limit reached. Please wait a minute and try again.';
      if (hasImg && [400, 403, 404].includes(up.status) && /model/i.test(msg)) msg = 'Reading photos is not available right now. Please try again later, or ask your question in words.';
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
  if (req.method === 'POST' && url.pathname === '/api/image') return image(req, res);
  if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { ...(AUTH_ON ? { supabaseUrl: SB_URL, anonKey: SB_KEY } : {}), cf: CF_ON });
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Zint AI running at http://localhost:${PORT}  (provider: ${PROVIDER || 'NONE'}, model: ${MODEL}, key ${PROVIDER ? 'set' : 'MISSING'}, login ${AUTH_ON ? 'REQUIRED' : 'off'}, fast images ${CF_ON ? 'on' : 'off'})`));
