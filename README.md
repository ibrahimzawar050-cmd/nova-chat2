# Zint AI – AI chatbot

Real streaming AI answers through a secure Node backend. Zero npm dependencies.

## Free setup (Groq, no credit card)
1. Install Node.js 18+ (nodejs.org).
2. Make a free account at https://console.groq.com and create a key at https://console.groq.com/keys
3. Copy `.env.example` to `.env` and put your key after `GROQ_API_KEY=`
4. Run `node server.js` and open http://localhost:3000

Default free model: `openai/gpt-oss-120b`; Zint AI automatically tries other free Groq models if it is unavailable (force one with `MODEL=` in `.env`).
Free tiers have rate limits; if you hit one, wait a minute. Free-tier terms can change.

Paid alternative: set `ANTHROPIC_API_KEY` instead (Groq is used if both are set).

The key is read only by `server.js`; the browser only talks to `/api/chat`. Never commit `.env`.
For hosting, see DEPLOY.md (set `GROQ_API_KEY` as the environment variable).

## Netlify
See NETLIFY.md to publish on Netlify (uses netlify/functions instead of server.js).
