# Faster images (optional, free): Cloudflare Workers AI

Without this, Zint AI draws pictures with the free Pollinations service, which can be slow.
With it, pictures come from Cloudflare's FLUX model through your own server (free daily allowance, no card).

1. Make a free account at https://dash.cloudflare.com/sign-up
2. Account ID: after logging in, look at the address bar. It looks like dash.cloudflare.com/<32 letters and numbers>/home. That long part is your Account ID.
3. API token: open https://dash.cloudflare.com/profile/api-tokens -> Create Token -> find the "Workers AI" template -> Use template -> Continue to summary -> Create Token. Copy the token now (it is shown only once).
4. Local: add these lines to your .env file, then restart Zint AI:
   CF_ACCOUNT_ID=your-account-id
   CF_API_TOKEN=your-token
5. Netlify: Site configuration -> Environment variables -> add CF_ACCOUNT_ID and CF_API_TOKEN (tick "Contains secret values" for the token), then Deploys -> Trigger deploy.

Notes
- Pictures made this way are not stored in saved chats (they would be too big). After a refresh Zint AI shows "not saved - tap New version".
- When login is switched on, only logged-in people can create images (guests are blocked on the server). Limit: 10 images per 10 minutes per user.
- If you see an error about terms, open the Cloudflare dashboard, go to AI -> Workers AI once, and accept.
