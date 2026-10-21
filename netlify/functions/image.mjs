// Nova image endpoint for Netlify: Cloudflare Workers AI (FLUX), with login/guest limits.
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
  const id = env('CF_ACCOUNT_ID'), token = env('CF_API_TOKEN');
  if (!id || !token) return json({ error: 'The image service is not configured.' }, 501);
  let who = 'ip:' + ((context && context.ip) || 'anon'), max = 10; // per 10 minutes per logged-in user (guests are not allowed to create images)
  const sbUrl = (env('SUPABASE_URL') || '').replace(/\/$/, ''), sbKey = env('SUPABASE_ANON_KEY') || '';
  if (sbUrl && sbKey) {
    if ((req.headers.get('authorization') || '').startsWith('Bearer ')) {
      const uid = await authUser(req, sbUrl, sbKey);
      if (!uid) return json({ error: 'Your login expired. Please refresh the page and log in again.' }, 401);
      who = uid;
    } else return json({ error: 'Please log in to create images. Guests can chat, but pictures are for people with an account.' }, 403);
  }
  if (limited(who + ':img', max)) return json({ error: 'Image limit reached. Please wait a few minutes and try again.' }, 429);
  let prompt;
  try { prompt = String((await req.json()).prompt || '').trim().slice(0, 500); if (!prompt) throw 0; }
  catch { return json({ error: 'Please describe the image you want.' }, 400); }
  try {
    const base = env('CF_BASE_URL') || 'https://api.cloudflare.com/client/v4';
    const r = await fetch(`${base}/accounts/${id}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, steps: 6 }), signal: AbortSignal.timeout(25000)
    });
    const j = await r.json().catch(() => ({}));
    const img = j.result && j.result.image;
    if (!r.ok || !img) {
      const msg = (j.errors && j.errors[0] && j.errors[0].message) || `Image service error (${r.status})`;
      return json({ error: r.status === 429 || /limit|neurons|quota/i.test(msg) ? 'The free daily image allowance is used up. Please try again tomorrow.' : msg }, 502);
    }
    return json({ image: img });
  } catch { return json({ error: 'The image service did not respond. Please try again.' }, 502); }
};
export const config = { path: '/api/image' };
