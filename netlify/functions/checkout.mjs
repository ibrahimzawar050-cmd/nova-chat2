// Starts a Stripe Checkout page for Zint AI Plus. The Stripe secret key lives only in Netlify's environment variables.
import { env, json, whoIs, myPlan, stripe } from '../lib/plan.mjs';
export default async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env('STRIPE_SECRET_KEY') || !env('STRIPE_PRICE_ID')) return json({ error: 'Payments are not switched on yet.' }, 501);
  const u = await whoIs(req); if (!u) return json({ error: 'Please log in first.' }, 401);
  const origin = new URL(req.url).origin, plan = await myPlan(req);
  const form = { mode: 'subscription', 'line_items[0][price]': env('STRIPE_PRICE_ID'), 'line_items[0][quantity]': '1', client_reference_id: u.id, allow_promotion_codes: 'true', success_url: origin + '/?plus=ok', cancel_url: origin + '/' };
  if (plan.customer) form.customer = plan.customer; else form.customer_email = u.email;
  const r = await stripe('/checkout/sessions', form);
  if (!r.ok || !r.body.url) return json({ error: 'Could not open the payment page. Please try again.' }, 502);
  return json({ url: r.body.url });
};
export const config = { path: '/api/checkout' };
