# The Fatty website

Download site for the Android game **The Fatty** (formerly "The Belt"; the Unity project/repo is still called The Belt). Being extended with a backend, analytics, roles and a community page.

## How to work
Act like a senior full-stack developer: own the whole feature from the static frontend through the Fastify API to the Supabase schema, think about security and failure modes, and keep changes small and verified.

## The game (source of truth for site copy)
2D top-down zombie action game for Android, built in Unity 6. You fight with a physics belt, rescue villagers from cages, and they join your village where jobs pay for upgrades.
- **Loop:** pick a mission -> play the stage (fight, chests, free cages) -> chest screen pays coins/gems on first completion -> village (jobs, upgrades, forge) -> each mission advances the village one day.
- **Combat:** joystick + attack button, belt swing with spam-combo heat (up to 2.5x speed), stamina, auto flashlight, day/night, roofs fade indoors.
- **First launch:** tutorial (find the belt in a chest, zombie counter, Skip Tutorial in the pause menu).
- **Zombies:** Normal, Crawler, Runner, Brute, Spitter; bosses Log Brute (mission 5) and Bog Brute (mission 10, guards the caged dog Rex).
- **Power-ups:** Beer, Burger, Energy drink, Fart (unlocked after mission 5), Beans.
- **Missions:** 10 across Forest (1-5) and Swamp (6-10). Mission 1: 15 zombies, 50 coins + 2 gems. Mission 10: 25 zombies x2.0 health / x1.8 damage, 800 coins + 6 gems. Each mission hides 3-6 loot chests (about 1 in 6 golden, with gems).
- **Village:** 9 jobs (incl. Trader), 7 upgradeable work buildings (max level 3, output up to x2.25), forge (player upgrades + crafting), trading post and shop, Rex the dog + dog shed, beer party every 2 days, nightly horde (horn 20:00, attack 21:00; barricades, watchtowers with guards, raiders that steal and flee).
- **Planned:** proper horde/arrow/wood sounds, a third region, a building-materials mode, balancing and testing the tap games on phones.
Keep website copy consistent with this; do not invent features.

## Layout
- Repo root: static frontend served by GitHub Pages (`index.html`, `script.js`, `style.css`). No build step. Keep it that way.
- `api/`: Node.js + TypeScript + Fastify backend (Render free tier). Also serves the admin pages (`api/public/admin/`). `api/scripts/publish-release.ts` uploads APKs to R2.
- `supabase/`: SQL migrations (Postgres, Auth, RLS) and setup README.
- `update-apk.sh`: release script (R2 upload + Supabase release row + `script.js` link, then commit/push). `release.cmd` runs it with prompts.
- `update-windows.sh` / `release-windows.cmd`: same for the Windows build (a ZIP, platform `windows`); the Windows button, guide and FAQ on the site stay hidden until `WIN_PATH` in `script.js` is set.

## Decisions already made
- DB + Auth: Supabase. APK storage: Cloudflare R2 (Supabase free caps files at 50 MB, the APK is ~54 MB).
- Backend: Fastify + TypeScript + zod. The API signs users in against Supabase Auth, verifies the access token on each request and reads the role from `profiles`. `Authorization: Bearer` is still accepted for tools (Scalar, scripts).
- Roles: `user` (default) and `admin`. Role is only changed via SQL, never from the client. The real check is on `/api/admin/*` (403 otherwise).
- Sessions: HttpOnly, SameSite=Strict cookies (`__Host-` + Secure in production) set by the API; no tokens in localStorage or JS. GitHub Pages (github.io) and Render (onrender.com) are different sites, so the admin pages are **served by the API** from `api/public/admin/` (first-party cookie, strict CSP). `admin.html` on Pages is only a gateway that wakes the API (with an animation) and redirects.
- CSRF: state-changing auth routes require `Origin === PUBLIC_URL`; CORS never allows credentials. Login has a per-IP and a per-account limit.
- Client IP: `trustProxy` trusts only `TRUST_PROXY_HOPS` (default 1) hops. Never set it to `true`: Render does not strip a client-sent X-Forwarded-For.
- Download button links directly to the R2 URL and fires a keepalive `fetch` to `/api/download`, so the download never depends on a sleeping Render instance.
- Email: Supabase built-in mailer is far too limited, and Resend cannot send to arbitrary users without an owned domain. So the community page uses Discord + Google OAuth (PKCE, handled server-side in `api/src/routes/auth.ts`); email/password stays for the admin only. Reviews require a verified email and a public username (3-30 chars, unique ignoring case, impersonation words blocked).
- Community: `/community/` is served by the API (first-party cookie), reached from Pages through the `community.html` gateway. Reviews appear immediately; admins hide/unhide/delete at `/admin/reviews.html`. Public review GETs are cookie-less and never cached; all user text is rendered with `textContent` only. Never add `aggregateRating` markup unless the numbers are real and shown.
- No custom domain: site is on `github.io`, so CORS must allow exactly that origin.

## Rules
- Secrets (service-role key, R2 keys, `.env*`) never go in the repo or the frontend. They live in `api/.env` only, never in `.env.example`.
- Store hashed IPs with a rotating salt, never raw IPs.
- Do not commit or push unless asked. Do not rewrite git history (APKs are in it) without explicit approval.
- Prefer the smallest change; reuse existing patterns. Validate all external input with zod.

## Commands
- `cd api && npm run dev` (Scalar docs at http://localhost:3000/docs, admin at http://localhost:3000/admin/), `npm test`, `npm run typecheck`
- `cd api && npm run release -- <apk> <version> --dry-run` checks R2 + Supabase without uploading

## SEO and marketing
Use the `seo-marketing` agent (`.claude/agents/seo-marketing.md`) for SEO audits, keyword and copy work and promotion planning. Site facts: GitHub Pages project page (no custom domain: no root robots.txt, shared github.io authority), JSON-LD in `index.html`, `sitemap.xml`, `assets/og-image.png` (share image built from the game art; brand files in `assets/brand/`: logo, mobile logo, YouTube banner), fonts self-hosted in `assets/fonts/` and `api/public/admin/fonts/` (no third-party requests; the API CSP allows only 'self'). Never add fake ratings, reviews or counts to the markup.

## Security review
Run the `security-reviewer` agent (`.claude/agents/security-reviewer.md`) after changes to auth, cookies, headers, routes, SQL or the admin UI.
