// Tells the browser whether login is enabled (Supabase URL + public key; both are safe to expose).
const env = k => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
export default async () => {
  const url = (env('SUPABASE_URL') || '').replace(/\/$/, ''), key = env('SUPABASE_ANON_KEY') || '';
  const cf = !!(env('CF_ACCOUNT_ID') && env('CF_API_TOKEN'));
  return new Response(JSON.stringify({ ...(url && key ? { supabaseUrl: url, anonKey: key } : {}), cf, video: !!env('POLLINATIONS_KEY'), videoMode: env('POLLINATIONS_APP_KEY') ? 'byop' : env('POLLINATIONS_KEY') ? 'shared' : '', pollenApp: env('POLLINATIONS_APP_KEY') || '', videoModel: env('VIDEO_MODEL') || 'wan-fast' }), { headers: { 'content-type': 'application/json' } });
};
export const config = { path: '/api/config' };
