# Put Nova online (free, with Render)

1. Create a free account at https://github.com and make a new repository called `nova-chat`.
2. Upload every file from this folder (drag and drop works on GitHub's "uploading an existing file" page). Do NOT upload a `.env` file.
3. Create a free account at https://render.com and sign in with GitHub.
4. Click New → Web Service → pick your `nova-chat` repository.
5. Settings: Runtime = Node, Build Command = (leave empty), Start Command = `node server.js`, Instance type = Free.
6. Under Environment Variables add `GROQ_API_KEY` = your free Groq key.
7. Click Create Web Service. After a minute or two Render gives you a public https://nova-chat-xxxx.onrender.com link.

Notes: the free plan sleeps after inactivity (first load can take ~30s). Anyone with the link can use your API credit, so keep the link private and set a spending limit in the Anthropic console.

## Accounts
To require login and save chats per user, follow ACCOUNTS.md. On Render also add SUPABASE_URL and SUPABASE_ANON_KEY as environment variables.
