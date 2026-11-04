# Supabase setup

## 1. Run the migrations
Supabase dashboard → **SQL Editor** → New query. Paste and run each file **in order**:

1. `migrations/0001_profiles.sql`
2. `migrations/0002_releases_and_downloads.sql`
3. `migrations/0003_reviews.sql`
4. `migrations/0004_download_analytics.sql` (the admin dashboard's stats function)
5. `migrations/0005_community.sql` (usernames and the review summary; community page)
6. `migrations/0006_reviews_private_columns.sql` (stops the public key reading review author ids)
7. `migrations/0007_windows_releases.sql` (releases get a platform so Windows ZIPs can be published; needed before `update-windows.sh`)

Each file is meant to run once. If one fails, fix the cause and rerun only that file after dropping what it half-created.

## 2. Create your admin account
Dashboard → **Authentication → Users → Add user** (email + password, tick *Auto Confirm User*).
The signup trigger creates the profile with role `user`. Promote it once, in the SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'YOUR-EMAIL-HERE');
```

The role can only be changed this way. The API never accepts a role from a client.

## 3. Auth settings
Dashboard → **Authentication**:
- **Providers → Email**: keep *Confirm email* on.
- **URL Configuration**: Site URL = `https://orlinstefanov.github.io/TheFattyWebsite/` (adjust to your Pages URL); add the same under Redirect URLs, plus `http://localhost:*` for local testing.
- **SMTP** (before public launch): the built-in mailer is heavily rate-limited. Add Resend SMTP credentials.

## 4. Sign in to the admin page
The API serves the admin pages itself, so the session cookie is first-party and HttpOnly (no token ever reaches browser JavaScript).
1. Set `SUPABASE_ANON_KEY` (Project Settings -> API, the **anon / publishable** key) in `api/.env` locally and in the Render service's environment. It is used by the API only; it is not in the website.
2. Open the site's **Admin** link (`admin.html`). It wakes the API (with an animation), then redirects to `<API>/admin/`. Sign in with the admin account.
   Locally: `npm run dev` in `api/` and open http://localhost:3000/admin/.
   A normal user sees "No access"; the API enforces this too (403).

## 5. Test the API with Scalar (optional)
`npm run dev` in `api/`, open http://localhost:3000/docs. The Bearer field accepts a Supabase `access_token`; get one by calling
`POST {SUPABASE_URL}/auth/v1/token?grant_type=password` with header `apikey: <anon key>`. Don't paste passwords into chats or tickets.

## 6. Community sign-in: Discord and Google
Players sign in with Discord or Google (no emails are sent, and the provider has already verified the address). The API handles the whole flow; nothing is needed in the website code. Do this once:

**A. Tell Supabase where to send people back.** Authentication -> URL Configuration -> **Redirect URLs**, add:
- `https://thefatty-api.onrender.com/api/auth/callback`
- `http://localhost:3000/api/auth/callback` (only if you test locally)

Your project's own callback address is shown on each provider's page in Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`). You paste that into Discord and Google below.

**B. Discord.**
1. https://discord.com/developers/applications -> **New Application** (name it "The Fatty").
2. **OAuth2** -> copy the **Client ID**, click **Reset Secret** and copy the **Client Secret**.
3. OAuth2 -> **Redirects** -> add the Supabase callback address above, then save.
4. Supabase -> Authentication -> Sign In / Providers -> **Discord** -> enable, paste the Client ID and Secret, save.

**C. Google.**
1. https://console.cloud.google.com -> create a project.
2. APIs & Services -> **OAuth consent screen** -> External. Fill in the app name, a support email and a developer contact email. Leave the default scopes (email, profile, openid). Click **Publish app** so anyone can sign in (otherwise only listed test users can).
3. APIs & Services -> **Credentials** -> Create credentials -> **OAuth client ID** -> Web application. Under *Authorized redirect URIs* add the Supabase callback address. Create it and copy the Client ID and Secret.
4. Supabase -> Authentication -> Sign In / Providers -> **Google** -> enable, paste both, save.

**D. Check it.** Open the site's **Community** link, click *Continue with Discord* (or Google), pick a public name, and post a review. Admins moderate at `<API>/admin/reviews.html`.

## 7. Hardening checklist (Supabase dashboard)
- **Keep "Allow new users to sign up" ON.** It also controls Discord/Google sign-up; turning it off would stop new players from signing in.
- **Account linking (important).** Supabase links a Discord/Google sign-in to an existing account with the same email. If email/password sign-up stays open, someone could register `victim@gmail.com` with their own password and be linked to that person's account when the real owner later signs in with Google. Keep **Confirm email** ON (Authentication -> Sign In / Providers -> Email) so such accounts stay unusable, and only enable providers that return verified emails (Google and Discord do).
- **Stronger, recommended once everything works:** sign in to the community page yourself with Discord or Google, promote that profile to admin (the SQL in step 2, using that account's email), check that `/admin/` works for it, and then **turn the Email provider off**. Nobody can then create or log into an email/password account at all, and the pre-hijack risk disappears. Keep the email provider on until you have verified your admin works through Discord or Google, or you will lock yourself out. After signing in on the community page, an *Admin* link appears in its header.
- Use a long unique password for the admin account and enable MFA if you can.
- Players can delete their own account on the community page (this removes their profile and review). Admin accounts cannot be deleted from there on purpose.
- Optionally purge old `download_events` rows (for example older than 180 days).
