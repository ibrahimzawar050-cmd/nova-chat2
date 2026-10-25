import { isPlus } from '../lib/plan.mjs';
// Zint AI chat endpoint for Netlify: checks login (if enabled), calls Groq, streams the answer back.
// The API key lives only in Netlify's environment variables, never in the browser.
const env = k => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
const MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];
const tokens = new Map(), hits = new Map();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const SYSTEM = () => `You are Zint AI, a friendly, accurate AI assistant. Today is ${new Date().toDateString()}.
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
  live: 'MODE: Live information. Fresh web search results are provided below. Answer from them, say where the information came from, and say plainly if the results do not answer the question. Never invent scores, prices or facts.',
  learn: 'MODE: Guided learning. Be a patient Socratic tutor. Do not dump the full answer at once. Begin by asking one short question about what the learner already knows, then teach in small steps: explain one idea, then ask one check question. Give hints instead of answers when they are stuck, praise effort, and finish with a short recap and an offer of a quick quiz.'
};
const sys = mode => SYSTEM() + (MODES[mode] ? '\n\n' + MODES[mode] : '');


// Accepts plain text, or text + photos (data URLs). Returns cleaned messages and whether any photo is present.
const VISION_MODEL = env('VISION_MODEL') || 'qwen/qwen3.8-27b';
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

async function authUser(req, url, key) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!t) return null;
  const c = tokens.get(t); if (c && c.exp > Date.now()) return c.uid;
  try {
    const r = await fetch(url + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + t } });
    if (!r.ok) return null;
    const u = await r.json(); if (tokens.size > 500) tokens.clear();
    tokens.set(t, { uid: u.id, exp: Date.now() + 60000 }); return u.id;
  } catch { return null; }
}
// 40 messages per 10 minutes per user (or per IP when login is off). Best-effort: resets when the function restarts.
const limited = (who, max = 40) => { const now = Date.now(), a = (hits.get(who) || []).filter(x => now - x < 600000); a.push(now); hits.set(who, a); if (hits.size > 2000) hits.clear(); return a.length > max; };

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = env('GROQ_API_KEY');
  if (!key) return json({ error: 'The server has no GROQ_API_KEY configured. Add it in Netlify -> Site configuration -> Environment variables, then redeploy.' }, 500);

  let who = (context && context.ip) || 'anon';
  const sbUrl = (env('SUPABASE_URL') || '').replace(/\/$/, ''), sbKey = env('SUPABASE_ANON_KEY') || '';
  let max = 40, isGuest = false;
  if (sbUrl && sbKey) {
    if ((req.headers.get('authorization') || '').startsWith('Bearer ')) {
      const uid = await authUser(req, sbUrl, sbKey);
      if (!uid) return json({ error: 'Your login expired. Please refresh the page and log in again.' }, 401);
      who = uid; if (await isPlus(req)) max = 150; // Zint AI Plus: higher limit
    } else { who = 'guest:' + who; max = 15; isGuest = true; } // guests: no login, lower limit
  }
  if (limited(who, max)) return json({ error: max === 15 ? 'Guest limit reached. Please wait a few minutes, or log in for more messages.' : 'You are sending messages very fast. Please wait a few minutes.' }, 429);

  let messages, mode, hasImg = false;
  try {
    const body = await req.json();
    mode = typeof body.mode === 'string' ? body.mode : null;
    if (isGuest && MODES[mode]) return json({ error: 'Please log in to use the tools. Guests can chat, but the tools menu is for people with an account.' }, 403);
    ({ messages, hasImg } = cleanMessages(body.messages || []));
    if (!messages.length || messages[0].role !== 'user') throw new Error('Invalid conversation');
  } catch (e) { return json({ error: e.message || 'Bad request' }, 400); }

  let system = sys(mode);
  if (mode === 'live') { // free web search (Tavily) so the answer can use live information
    const q = [...messages].reverse().find(m => m.role === 'user');
    const text = q ? (typeof q.content === 'string' ? q.content : q.content.filter(p => p.type === 'text').map(p => p.text).join(' ')) : '';
    if (!env('TAVILY_API_KEY')) return json({ error: 'Live information is not switched on yet.' }, 501);
    if (!(await isPlus(req))) return json({ error: 'Live info is for Zint AI Plus members.' }, 403);
    try {
      const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { Authorization: 'Bearer ' + env('TAVILY_API_KEY'), 'content-type': 'application/json' }, body: JSON.stringify({ query: text.slice(0, 300), max_results: 5, include_answer: true }), signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('search');
      system += `\n\nSEARCH RESULTS (${new Date().toUTCString()}):\n` + (j.answer ? `Summary: ${j.answer}\n` : '') + (j.results || []).map((x, i) => `[${i + 1}] ${x.title} (${x.url})\n${String(x.content || '').slice(0, 600)}`).join('\n');
    } catch { return json({ error: 'The live search did not work. Please try again in a moment.' }, 502); }
  }
  const base = env('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1';
  const call = model => fetch(base + '/chat/completions', {
    method: 'POST', signal: req.signal,
    headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 4096, stream: true, messages: [{ role: 'system', content: system }, ...messages],
      ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {})
    })
  });
  let up;
  try {
    const tries = hasImg ? [VISION_MODEL] : env('MODEL') ? [env('MODEL')] : MODELS;
    for (const m of tries) { // Groq's free models change, so try the next one if a model is unavailable
      up = await call(m);
      if (up.ok || ![400, 403, 404].includes(up.status)) break;
      if (!/model/i.test(await up.clone().text())) break;
    }
  } catch { return json({ error: "Could not reach the AI service. Please try again." }, 502); }
  if (!up.ok) {
    let msg = `AI service error (${up.status})`;
    try { msg = (await up.json()).error.message || msg; } catch {}
    if (up.status === 401) msg = 'The AI key is invalid. Check GROQ_API_KEY in Netlify.';
    if (up.status === 429) msg = 'Free-tier rate limit reached. Please wait a minute and try again.';
    if (hasImg && [400, 403, 404].includes(up.status) && /model/i.test(msg)) msg = 'Reading photos is not available right now. Please try again later, or ask your question in words.';
    return json({ error: msg }, 502);
  }

  const enc = new TextEncoder(), dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = o => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      try {
        const reader = up.body.getReader(); let buf = '';
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            const t = ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content;
            if (t) send({ t }); else if (ev.error) send({ error: ev.error.message || 'AI error' });
          }
        }
      } catch { send({ error: 'Connection to the AI service was lost.' }); }
      ctrl.close();
    }
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
};
export const config = { path: '/api/chat' };
