// Tells the browser whether login is enabled (Supabase URL + public key; both are safe to expose).
const env = k => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
export default async () => {
  const url = (env('SUPABASE_URL') || '').replace(/\/$/, ''), key = env('SUPABASE_ANON_KEY') || '';
  const cf = !!(env('CF_ACCOUNT_ID') && env('CF_API_TOKEN'));
  const pay = !!(env('STRIPE_SECRET_KEY') && env('STRIPE_PRICE_ID') && env('STRIPE_WEBHOOK_SECRET') && env('SUPABASE_SERVICE_KEY'));
  return new Response(JSON.stringify({ ...(url && key ? { supabaseUrl: url, anonKey: key } : {}), cf, pay, video: pay && !!env('LUMA_API_KEY') && !!env('SUPABASE_SERVICE_KEY'), live: !!env('TAVILY_API_KEY') }), { headers: { 'content-type': 'application/json' } });
};
export const config = { path: '/api/config' };
