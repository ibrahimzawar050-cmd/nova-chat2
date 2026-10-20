# Publish Nova on Netlify (free)

Works with or without logins. Without Supabase settings, anyone with the link can chat (each person's chats stay in their own browser).

1. Open Terminal and run:   cd ~/Downloads/nova-chat && npx netlify-cli deploy --prod
   - If it asks to install netlify-cli, type y and press Enter.
   - A browser tab opens: log in to Netlify and click Authorize.
   - Back in Terminal choose: "Create & configure a new project", then your team, then a site name (e.g. my-nova-chat).
   - It finishes by printing a "Website URL".
2. In Netlify (app.netlify.com) open your site -> Site configuration -> Environment variables -> Add a variable:
   Key: GROQ_API_KEY   Value: your Groq key   (Save)
3. Run the deploy command from step 1 again (new settings only apply after a new deploy).
4. Open your Website URL and send a message.

Later, to turn on logins: follow ACCOUNTS.md, then add SUPABASE_URL and SUPABASE_ANON_KEY the same way as step 2 and redeploy.

Notes: the free plan has monthly limits; a 40-messages-per-10-minutes limit per person protects your Groq allowance.
The Netlify version uses Groq only (not Anthropic).
