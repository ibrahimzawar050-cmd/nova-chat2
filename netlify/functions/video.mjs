// Aura video endpoint for Netlify: Pollinations (free weekly credits). The secret key stays in Netlify's settings.
const env = k => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
const tokens = new Map(), hits = new Map();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
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
const limited = (who, max) => { const now = Date.now(), a = (hits.get(who) || []).filter(x => now - x < 600000); a.push(now); hits.set(who, a); if (hits.size > 2000) hits.clear(); return a.length > max; };

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = env('POLLINATIONS_KEY');
  if (!key) return json({ error: 'Video is not set up yet. The owner needs to add a free Pollinations key (see VIDEOS.md).' }, 501);
  let who = 'ip:' + ((context && context.ip) || 'anon');
  const sbUrl = (env('SUPABASE_URL') || '').replace(/\/$/, ''), sbKey = env('SUPABASE_ANON_KEY') || '';
  if (sbUrl && sbKey) {
    if (!(req.headers.get('authorization') || '').startsWith('Bearer ')) return json({ error: 'Please log in to use the tools. Guests can chat, but the tools menu is for people with an account.' }, 403);
    const uid = await authUser(req, sbUrl, sbKey);
    if (!uid) return json({ error: 'Your login expired. Please refresh the page and log in again.' }, 401);
    who = uid;
  }
  if (limited(who + ':vid', 8)) return json({ error: 'Video limit reached (8 clips per 10 minutes). Please wait a few minutes.' }, 429);
  let prompt;
  try { prompt = String((await req.json()).prompt || '').trim().slice(0, 400); if (!prompt) throw 0; }
  catch { return json({ error: 'Please describe the video you want.' }, 400); }
  try {
    const u = new URL((env('POLLINATIONS_BASE_URL') || 'https://gen.pollinations.ai') + '/video/' + encodeURIComponent(prompt));
    u.searchParams.set('model', env('VIDEO_MODEL') || 'wan-fast');
    const up = await fetch(u, { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(55000) });
    const type = up.headers.get('content-type') || '';
    if (!up.ok || !type.startsWith('video/')) {
      let msg = `Video service error (${up.status})`; try { msg = (await up.json()).error.message || msg; } catch {}
      if ([402, 429].includes(up.status)) msg = 'The free video allowance is used up for now. Please try again later.';
      return json({ error: msg }, 502);
    }
    return new Response(up.body, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
  } catch { return json({ error: 'The video service did not respond in time. Please try again.' }, 502); }
};
export const config = { path: '/api/video' };
