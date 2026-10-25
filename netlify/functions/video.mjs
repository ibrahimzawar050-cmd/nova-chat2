// Zint AI Plus video maker (Luma). Plus members only, with daily limits so the bill can never run away.
// 5s = 1 clip; 10s = 2 clips joined with Luma's "extend"; 20s = 4 clips. Each clip counts as 1 unit toward the daily limits.
import { env, json, sbUrl, whoIs, isPlus } from '../lib/plan.mjs';
const LUMA = 'https://api.lumalabs.ai/dream-machine/v1';
const svc = () => env('SUPABASE_SERVICE_KEY');
const sb = (path, method = 'GET', body, extra = {}) => fetch(sbUrl() + '/rest/v1/' + path, {
  method, headers: { apikey: svc(), Authorization: 'Bearer ' + svc(), 'content-type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined
});
const dayAgo = () => new Date(Date.now() - 864e5).toISOString();
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); }; // each person's limit resets on the 1st
async function used(filter, from) { // clip units started since `from` (if unsure, say "limit reached")
  const r = await sb(`videos?select=units&created=gte.${encodeURIComponent(from)}${filter}&limit=5000`);
  return r.ok ? (await r.json()).reduce((a, x) => a + (x.units || 1), 0) : 1e9;
}
const luma = (path, L, body) => fetch(LUMA + path, { method: body ? 'POST' : 'GET', headers: L, body: body ? JSON.stringify(body) : undefined });
const settings = () => ({ model: env('VIDEO_MODEL') || 'ray-3.2', resolution: env('VIDEO_RES') || '540p', aspect_ratio: '16:9' });

export default async req => {
  if (!env('LUMA_API_KEY') || !svc() || !sbUrl()) return json({ error: 'Video is not switched on yet.' }, 501);
  const u = await whoIs(req); if (!u) return json({ error: 'Please log in first.' }, 401);
  if (!(await isPlus(req))) return json({ error: 'Videos are for Zint AI Plus members.' }, 403);
  const L = { Authorization: 'Bearer ' + env('LUMA_API_KEY'), 'content-type': 'application/json' };

  if (req.method === 'GET') { // check on a video; moves a long video on to its next clip when one finishes
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id) || id < 1) return json({ error: 'Bad request' }, 400);
    const rr = await sb(`videos?select=*&id=eq.${id}&user_id=eq.${u.id}`);
    const row = rr.ok ? (await rr.json())[0] : null; if (!row || !row.gen_id) return json({ error: 'Video not found.' }, 404);
    const r = await luma('/generations/' + encodeURIComponent(row.gen_id), L).catch(() => null);
    const g = r && r.ok ? await r.json().catch(() => ({})) : {};
    if (g.state === 'failed') return json({ state: 'failed', error: 'The video could not be made. Try a different idea.' });
    if (g.state !== 'completed' || !(g.assets && g.assets.video)) return json({ state: 'working' });
    if (!(row.remaining > 0)) return json({ state: 'done', url: g.assets.video });
    // next clip: continue from the one that just finished
    const nx = await luma('/generations', L, { prompt: row.prompt, ...settings(), keyframes: { frame0: { type: 'generation', id: row.gen_id } } }).catch(() => null);
    const ng = nx && nx.ok ? await nx.json().catch(() => ({})) : {};
    if (!ng.id) return json({ state: 'failed', error: 'The video could not be made. Try again.' });
    await sb(`videos?id=eq.${id}&gen_id=eq.${encodeURIComponent(row.gen_id)}`, 'PATCH', { gen_id: ng.id, remaining: row.remaining - 1 }); // only one poll wins
    return json({ state: 'working' });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let prompt, secs; try { const b = await req.json(); prompt = String(b.prompt || '').trim().slice(0, 500); secs = Number(b.secs); if (!prompt || ![5, 10, 20].includes(secs)) throw 0; } catch { return json({ error: 'Please describe the video you want.' }, 400); }
  const units = secs / 5, perUser = Number(env('VIDEO_MONTHLY')) || 20, global = Number(env('VIDEO_GLOBAL_DAILY')) || 40;
  if ((await used(`&user_id=eq.${u.id}`, monthStart())) + units > perUser) return json({ error: 'You have used all your videos for this month. They come back on the 1st.' }, 429);
  if ((await used('', dayAgo())) + units > global) return json({ error: 'Zint AI has made all of its videos for today. Please try again tomorrow.' }, 429);
  const ins = await sb('videos', 'POST', { user_id: u.id, prompt, units, remaining: units - 1 }, { Prefer: 'return=representation' }); // counted before paying Luma
  const row = ins.ok ? (await ins.json())[0] : null; if (!row) return json({ error: 'Could not start the video. Please try again.' }, 502);
  const undo = () => sb('videos?id=eq.' + row.id, 'DELETE');
  try {
    const r = await luma('/generations', L, { prompt, ...settings(), duration: '5s' });
    const g = await r.json().catch(() => ({}));
    if (!r.ok || !g.id) { await undo(); return json({ error: r.status === 402 || r.status === 429 ? 'The video service is out of credit or busy. Please try again later.' : 'The video service could not start. Please try again.' }, 502); }
    await sb('videos?id=eq.' + row.id, 'PATCH', { gen_id: g.id });
    return json({ id: row.id });
  } catch { await undo(); return json({ error: 'The video service did not respond. Please try again.' }, 502); }
};
export const config = { path: '/api/video' };
