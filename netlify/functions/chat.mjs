// Aura chat endpoint for Netlify: checks login (if enabled), calls Groq, streams the answer back.
// The API key lives only in Netlify's environment variables, never in the browser.
const env = k => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
const MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];
const tokens = new Map(), hits = new Map();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const SYSTEM = () => `You are Aura, a friendly, accurate AI assistant. Today is ${new Date().toDateString()}.
Help with maths, science, history, geography, coding, football, gaming, creative writing, summarising, translation and everyday life.
Explain hard topics simply when asked. Use Markdown (headings, bullets, fenced code blocks with language tags).
If you don't know something or aren't sure, say so plainly instead of guessing.`;

const MODES = {
  code: 'MODE: Coding. Act as a senior software engineer. Give complete, working code in fenced code blocks with a language tag, then a short explanation and how to run it. Ask a question only if something essential is missing.',
  write: 'MODE: Writing. Act as a skilled writing partner (essays, emails, stories, speeches, captions). Deliver a polished draft first, then offer one or two ways to adjust the tone or length.',
  song: 'MODE: Song writing. Write ORIGINAL song lyrics (never reproduce existing songs). Use labelled sections like [Verse 1], [Chorus], [Verse 2], [Bridge]. End with a short line suggesting style, tempo and a simple chord progression.',
  slides: 'MODE: Slides. Create a presentation. Reply with one short intro sentence, then the slides. Start EVERY slide with a line beginning "## " followed by the slide title (use "## " for nothing else). Under each title put 3 to 5 short bullet points. Make the first slide a title slide and the last a summary or next steps.',
  research: 'MODE: Deep research. You have NO live web access, so write a thorough, well-structured report from your own knowledge: summary, key facts, different viewpoints, open questions, and a section "What to double-check". Be clear about uncertainty. Never invent sources, links, quotes or statistics.',
  learn: 'MODE: Guided learning. Be a patient Socratic tutor. Do not dump the full answer at once. Begin by asking one short question about what the learner already knows, then teach in small steps: explain one idea, then ask one check question. Give hints instead of answers when they are stuck, praise effort, and finish with a short recap and an offer of a quick quiz.'
};
const sys = mode => SYSTEM() + (MODES[mode] ? '\n\n' + MODES[mode] : '');

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
  let max = 40;
  if (sbUrl && sbKey) {
    if ((req.headers.get('authorization') || '').startsWith('Bearer ')) {
      const uid = await authUser(req, sbUrl, sbKey);
      if (!uid) return json({ error: 'Your login expired. Please refresh the page and log in again.' }, 401);
      who = uid;
    } else { who = 'guest:' + who; max = 15; } // guests: no login, lower limit
  }
  if (limited(who, max)) return json({ error: max === 15 ? 'Guest limit reached. Please wait a few minutes, or log in for more messages.' : 'You are sending messages very fast. Please wait a few minutes.' }, 429);

  let messages, mode;
  try {
    const body = await req.json();
    mode = typeof body.mode === 'string' ? body.mode : null;
    messages = (body.messages || []).slice(-40)
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content }));
    if (!messages.length || messages[0].role !== 'user') throw new Error('Invalid conversation');
  } catch (e) { return json({ error: e.message || 'Bad request' }, 400); }

  const base = env('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1';
  const call = model => fetch(base + '/chat/completions', {
    method: 'POST', signal: req.signal,
    headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 4096, stream: true, messages: [{ role: 'system', content: sys(mode) }, ...messages],
      ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {})
    })
  });
  let up;
  try {
    const tries = env('MODEL') ? [env('MODEL')] : MODELS;
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
