# Steps (when you need to do something)

Whenever there are actions only you can do (e.g. in Supabase or your host), they’ll be listed here.

---

## Make the app work for everyone (different browsers / profiles)

So that sign-up and email confirmation work on **any** device or Chrome profile (not just the one you use for Cursor/GitHub):

1. Open **[Supabase Dashboard](https://supabase.com/dashboard)** → your project.
2. Go to **Authentication** → **URL Configuration**.
3. Under **Redirect URLs**, add **every URL** people will use to open the app, for example:
   - `http://localhost:3000` (or whatever port you use locally)
   - `http://localhost:8080` if you use a different port
   - Your production URL when you deploy (e.g. `https://yoursite.com`)
4. Click **Save**.

If a URL isn’t in this list, Supabase may redirect there after email confirmation and show “Email not confirmed.” Using the same browser profile everywhere often works because that profile might already have a session; other profiles need the exact URL added.

---

## One-time Supabase setup (if you haven’t already)

- **Create `leagues` table and RLS:** SQL Editor → New query → paste contents of `supabase/migrations/001_leagues.sql` → Run.  
  If you see “policy already exists”, the migration already ran; no need to run it again.
- **Email auth:** Authentication → Providers → Email → Enable, then Save.
- **Redirect URLs:** As above, add your app URL(s) so sign-up and confirmation work.

---

## Troubleshooting

- **“Email not confirmed” after clicking the link:** Add that page’s URL to Redirect URLs (see above), then open your app and use **Sign in** with the same email and password.
- **“Policy already exists”:** The table and policies are already in place; you can ignore that error. The migration file is safe to re-run (it drops policies first).
- **Can others see my leagues?** No. RLS limits each user to their own leagues only.
