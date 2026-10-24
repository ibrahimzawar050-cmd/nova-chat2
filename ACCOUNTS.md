# Add logins + saved chats (Supabase, free)

Without these settings Zint AI works exactly as before (no login, chats stay in the browser).
With them, people must log in with an email, and each person's chats are saved to their own account.

1. Make a free account at https://supabase.com and click New project (any name, pick a database password, nearest region).
2. Left menu -> SQL Editor -> New query. Paste everything from `supabase.sql`, click Run. You should see "Success".
3. Authentication -> Providers -> Email: switch OFF "Confirm email" (so sign-up works instantly without waiting for emails). Save.
4. Settings -> API Keys: copy the **Project URL** (Settings -> Data API / General) and the **publishable** key (starts `sb_publishable_`; the older "anon" key also works).
   NEVER use the "secret" or "service_role" key.
5. Put them in `.env` (local) or in Render's Environment Variables (online):
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_...
6. Restart Zint AI. It prints `login REQUIRED`.

Notes
- "Continue as guest" lets people chat without an account. Guests can chat but cannot use any tool in the tools menu (images, poem, code, write, slides, research, learning). This is enforced on the server. Guest chats are never saved (gone on refresh) and guests get a lower limit (15 messages per 10 minutes per person) than logged-in users (40).
- Chats saved in your browser before login are not moved to your account.
- No "forgot password" button yet; reset a user's password in Supabase -> Authentication -> Users.
- The login also protects your AI key: only logged-in users can chat, limited to 40 messages per 10 minutes each.
- Free Supabase projects pause after about a week without use; open the dashboard and click Restore if that happens.
