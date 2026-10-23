# Videos (optional): each visitor uses their own free Pollinations credits

Adds "Short video" (one ~5-second clip) and "Long video" (the AI plans 4 scenes, makes a clip for each and plays them back to back).

How it works: a visitor picks a video tool, clicks "Connect" and signs in at enter.pollinations.ai (free account, free starting credits).
Their own credits pay for their videos, so it costs you nothing however many people use it. Videos are fetched by the visitor's browser straight from Pollinations (no Netlify time or size limits).

Owner setup (once)
1. Make a free account at https://enter.pollinations.ai and click "Create New App Key". It is a PUBLISHABLE key that starts with pk_ (safe to put in the site).
2. Register the redirect URLs for that app key. They must match exactly, including the final slash:
   https://YOUR-SITE.netlify.app/
   http://localhost:3000/
3. Add the key as POLLINATIONS_APP_KEY:
   Netlify: Environment variables -> POLLINATIONS_APP_KEY=pk_... then one deploy.
   Local: add POLLINATIONS_APP_KEY=pk_... to .env and restart.
4. Optional: VIDEO_MODEL (default wan-fast). Model list: https://gen.pollinations.ai/video/models

Notes
- Guests cannot use the tools menu, so they cannot make videos. Visitors must log in to Aura AND connect Pollinations.
- The visitor's Pollinations key is stored in their own browser (localStorage). "Disconnect Pollinations" is in the tools menu.
- Videos are kept only in the open page. Use Download, or Make again after a refresh.
- Old option (shared key, uses YOUR credits): set POLLINATIONS_KEY=sk_... instead. It only applies when POLLINATIONS_APP_KEY is not set.
