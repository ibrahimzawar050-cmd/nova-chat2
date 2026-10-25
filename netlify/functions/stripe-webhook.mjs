// Stripe calls this after someone pays or cancels. It checks Stripe's signature, then switches Plus on or off.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env, json, sbUrl } from '../lib/plan.mjs';

export function verify(raw, header, secret, now = Date.now()) {
  const p = Object.fromEntries((header || '').split(',').map(x => x.split('=')));
  if (!p.t || !p.v1 || Math.abs(now / 1000 - Number(p.t)) > 300) return false;
  const want = createHmac('sha256', secret).update(`${p.t}.${raw}`).digest('hex');
  const a = Buffer.from(want), b = Buffer.from(p.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
const sb = (path, method, body, extra = {}) => fetch(sbUrl() + '/rest/v1/' + path, {
  method, headers: { apikey: env('SUPABASE_SERVICE_KEY'), Authorization: 'Bearer ' + env('SUPABASE_SERVICE_KEY'), 'content-type': 'application/json', ...extra }, body: JSON.stringify(body)
});

export default async req => {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (req.method !== 'POST' || !secret || !env('SUPABASE_SERVICE_KEY')) return json({ error: 'Not configured' }, 400);
  const raw = await req.text();
  if (!verify(raw, req.headers.get('stripe-signature'), secret)) return json({ error: 'Bad signature' }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: 'Bad body' }, 400); }
  const o = ev.data && ev.data.object || {};
  let r;
  if (ev.type === 'checkout.session.completed' && o.client_reference_id && o.mode === 'subscription') {
    r = await sb('plans?on_conflict=user_id', 'POST', { user_id: o.client_reference_id, plus: true, customer: o.customer, updated: new Date().toISOString() }, { Prefer: 'resolution=merge-duplicates' });
  } else if ((ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') && o.customer) {
    const on = ev.type !== 'customer.subscription.deleted' && ['active', 'trialing'].includes(o.status);
    r = await sb('plans?customer=eq.' + encodeURIComponent(o.customer), 'PATCH', { plus: on, updated: new Date().toISOString() });
  }
  if (r && !r.ok) return json({ error: 'Could not save' }, 500); // Stripe will retry
  return json({ ok: true });
};
export const config = { path: '/api/stripe-webhook' };
