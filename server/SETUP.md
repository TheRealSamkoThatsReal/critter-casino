# Critter Casino push backend — deploy guide

A tiny Cloudflare Worker that stores push subscriptions (KV) and sends a daily
"come back" reminder via an hourly cron. Free tier is plenty.

## One-time setup

You need a free Cloudflare account. All commands are run from this `server/`
folder. `npx` will fetch `wrangler` automatically.

```bash
cd server

# 1. Log in (opens a browser; in this session you can prefix with `! `)
npx wrangler login

# 2. Create the KV namespace that stores subscriptions
npx wrangler kv namespace create SUBS
#    -> copy the printed id into wrangler.toml (replace REPLACE_WITH_KV_NAMESPACE_ID)

# 3. Set the private VAPID key as a secret. The value is in server/.dev.vars
#    (git-ignored), on the line after `VAPID_PRIVATE=`. Easiest:
cat .dev.vars        # copy the key after VAPID_PRIVATE=
npx wrangler secret put VAPID_PRIVATE
#    -> paste that value when prompted

# 4. (optional) edit wrangler.toml -> VAPID_SUBJECT to your real email

# 5. Deploy
npx wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://critter-casino-push.<your-subdomain>.workers.dev`.

## Connect the frontend

Put that URL into `js/push.js` as `PUSH_BASE`, then commit/push the site so
GitHub Pages serves it. The 🔔 button in the app will then work.

## Notes

- **VAPID keys**: the public key is committed (in `wrangler.toml` and
  `js/push.js`); the private key lives only in `.dev.vars` (git-ignored) and as
  the Worker secret. If you ever rotate keys, update all three places.
- **Cost**: hourly cron + a KV read/write per subscriber is far under the free
  tier.
- **iOS**: push only works for the PWA once it's installed (Add to Home Screen),
  iOS 16.4+. Android Chrome and desktop work in-browser.
- **Test a push** after deploy: enable reminders in the app, then in the
  Cloudflare dashboard trigger the Worker's scheduled event, or temporarily set
  your reminder hour to the current local hour and wait for the next `:00`.
