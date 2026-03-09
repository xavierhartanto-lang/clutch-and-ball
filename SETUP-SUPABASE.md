# Supabase setup – what you need to do

The app is ready. You only need to do these steps **in your Supabase project** (one-time setup).

---

## Step 1: Create the `leagues` table and RLS

1. Open **[Supabase Dashboard](https://supabase.com/dashboard)** and select your project (the one whose URL and anon key are in `supabase.js`).
2. In the left sidebar, click **SQL Editor**.
3. Click **New query**.
4. Open the file **`supabase/migrations/001_leagues.sql`** in this project, copy **all** of its contents, and paste them into the SQL Editor.
5. Click **Run** (or press Cmd/Ctrl + Enter).
6. You should see “Success. No rows returned.” That means the `leagues` table and RLS policies were created.

---

## Step 2: Enable Email sign-up and sign-in

1. In the Supabase Dashboard left sidebar, go to **Authentication** → **Providers**.
2. Click **Email**.
3. Turn **Enable Email provider** ON (it may already be on).
4. (Optional) If you want users to confirm their email before signing in, configure **Confirm email** as you like. For quick testing you can leave it off so sign-up works immediately.
5. Click **Save**.

---

## Step 3: Confirm your site URL (for production later)

1. Go to **Authentication** → **URL Configuration**.
2. Add your site URL(s) to **Redirect URLs** when you deploy (e.g. `https://yourdomain.com`). For local testing, `http://localhost:3000` is usually allowed by default.

---

## Step 4: Test the app

1. Serve the site locally, e.g. run in the project folder:
   ```bash
   python3 -m http.server 3000
   ```
2. Open **http://localhost:3000** in your browser.
3. Scroll to **Create your league** (or click “Create League” in the nav).
4. Sign up with an email and password, then create a league. You should see it listed under “My leagues”.

If anything fails (e.g. “relation leagues does not exist” or “Email not confirmed”), double-check that you ran the SQL in Step 1 and that Email provider is enabled in Step 2.
