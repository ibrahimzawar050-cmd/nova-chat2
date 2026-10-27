# Zint AI Plus - switching on payments (do this WITH A GROWN-UP)

Stripe only lets adults (18+) have an account, so your dad does the Stripe parts.
Stripe takes a small fee from each payment. Nothing here costs money until someone pays.
Plus gives: more messages, more images, sharper photos, a Plus badge, Live info, and 5/10/20-second videos.

## 1. Supabase (you or dad)
SQL Editor -> New query -> paste ONLY the part of `supabase.sql` under "Zint AI Plus" -> Run.
Then Project Settings -> API Keys -> copy the SECRET key (service_role). Never share it or put it on GitHub.

## 2. Stripe (dad)
1. Make a Stripe account and finish "Activate payments". Start in Test mode.
2. Product catalogue -> Add product "Zint AI Plus" -> Recurring, monthly, set the price to 15 pounds a month (the Plus page says 15 pounds, so they must match) -> Save.
   Open it and copy the Price ID (starts with `price_`).
3. Developers -> API keys -> copy the Secret key (starts with `sk_`).
4. Settings -> Billing -> Customer portal -> turn it on (lets people cancel).
5. Developers -> Webhooks -> Add endpoint:
   - URL: https://YOUR-SITE.netlify.app/api/stripe-webhook
   - Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
   - After saving, copy the Signing secret (starts with `whsec_`).

## 3. Netlify -> Site configuration -> Environment variables
Add these 4 (tick "Contains secret values"):
- STRIPE_SECRET_KEY = the sk_ key
- STRIPE_PRICE_ID = the price_ id
- STRIPE_WEBHOOK_SECRET = the whsec_ secret
- SUPABASE_SERVICE_KEY = the Supabase secret key
Then upload this zip to GitHub so Netlify deploys again (15 credits).

## 4. Test
Log in -> "Upgrade to Plus" appears in the sidebar -> pay with Stripe's test card 4242 4242 4242 4242
(any future date, any CVC). After a few seconds a Plus badge shows. Then dad switches Stripe to Live mode
and swaps in the live keys, price id and a new live webhook secret.

## 5. Videos for Plus members (Luma) - this part costs real money, so dad does it
1. Dad makes an account at https://lumalabs.ai, then opens https://platform.lumalabs.ai (the key must start with luma-api-), adds a small prepaid amount
   (for example 5 pounds) and makes an API key. Turn auto top-up OFF so it can never spend more than he put in.
2. Supabase: SQL Editor -> New query -> paste the "Zint AI Plus videos" part of supabase.sql -> Run.
3. Netlify variable (tick "Contains secret values"): LUMA_API_KEY = the key. (SUPABASE_SERVICE_KEY from step 3 is also needed.)
4. Optional Netlify variables: VIDEO_MONTHLY (clips per person per MONTH, resets on the 1st, default 20 = five 20-second videos),
   VIDEO_GLOBAL_DAILY (clips for EVERYONE per day, a safety net, default 40), VIDEO_MODEL (default ray-3.2), VIDEO_RES (default 540p).
5. Deploy. Plus members now see 5-second, 10-second and 20-second videos in the tools menu.
5s and 10s videos are one clip; a 20-second video is a 10s clip plus two 5s extends. Luma charges by seconds made.
If nobody has Plus, nobody can make a video, so Luma is never charged.

## 6. Live info (free)
1. Go to https://tavily.com, make a free account and copy the API key (free plan has about 1,000 searches a month).
2. Netlify variable (tick "Contains secret values"): TAVILY_API_KEY = the key. Deploy.
3. Plus members now see "Live info" in the tools menu (scores, news, facts from the web). It is a Plus perk.

NOTE (Luma): Luma's new API is used. The key must start with luma-api- (platform.lumalabs.ai). 5s and 10s videos are one clip; a 20-second video is a 10s clip plus two 5s extends.
