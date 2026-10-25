// Helpers shared by the Zint AI Plus functions.
export const env = k => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
export const sbUrl = () => (env('SUPABASE_URL') || '').replace(/\/$/, '');
export const sbAnon = () => env('SUPABASE_ANON_KEY') || '';
export const bearer = req => (req.headers.get('authorization') || '').replace(/^Bearer /, '');

// Who is logged in? Returns { id, email } or null.
export async function whoIs(req) {
  const t = bearer(req); if (!t || !sbUrl()) return null;
  try {
    const r = await fetch(sbUrl() + '/auth/v1/user', { headers: { apikey: sbAnon(), Authorization: 'Bearer ' + t } });
    if (!r.ok) return null; const u = await r.json(); return { id: u.id, email: u.email };
  } catch { return null; }
}

// This person's own row in the "plans" table (Supabase row-level security only lets them read their own row).
export async function myPlan(req) {
  const t = bearer(req); if (!t || !sbUrl()) return {};
  try {
    const r = await fetch(sbUrl() + '/rest/v1/plans?select=plus,customer', { headers: { apikey: sbAnon(), Authorization: 'Bearer ' + t } });
    if (!r.ok) return {}; const rows = await r.json(); return rows[0] || {};
  } catch { return {}; }
}
const cache = new Map();
export async function isPlus(req) {
  const t = bearer(req); if (!t) return false;
  const c = cache.get(t); if (c && c.exp > Date.now()) return c.plus;
  const plus = !!(await myPlan(req)).plus;
  if (cache.size > 500) cache.clear();
  cache.set(t, { plus, exp: Date.now() + 60000 }); return plus;
}

export const stripe = (path, form) => fetch('https://api.stripe.com/v1' + path, {
  method: 'POST', headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'), 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(form)
}).then(async r => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
