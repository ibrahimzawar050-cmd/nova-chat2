// Opens Stripe's page where a Plus member can cancel or change their card.
import { env, json, whoIs, myPlan, stripe } from '../lib/plan.mjs';
export default async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env('STRIPE_SECRET_KEY')) return json({ error: 'Payments are not switched on yet.' }, 501);
  if (!(await whoIs(req))) return json({ error: 'Please log in first.' }, 401);
  const plan = await myPlan(req);
  if (!plan.customer) return json({ error: 'No subscription found.' }, 404);
  const r = await stripe('/billing_portal/sessions', { customer: plan.customer, return_url: new URL(req.url).origin + '/' });
  if (!r.ok || !r.body.url) return json({ error: 'Could not open the billing page. Please try again.' }, 502);
  return json({ url: r.body.url });
};
export const config = { path: '/api/portal' };
