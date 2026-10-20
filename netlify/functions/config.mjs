// Tells the browser whether login is enabled (Supabase URL + public key; both are safe to expose).
const env = k => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
export default async () => {
  const url = (env('SUPABASE_URL') || '').replace(/\/$/, ''), key = env('SUPABASE_ANON_KEY') || '';
  return new Response(JSON.stringify(url && key ? { supabaseUrl: url, anonKey: key } : {}), { headers: { 'content-type': 'application/json' } });
};
export const config = { path: '/api/config' };
