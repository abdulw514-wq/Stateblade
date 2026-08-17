# StateBlade

A free, live YouTube keyword/channel ranking tool — built as a single
Cloudflare Worker with static assets (Cloudflare's current recommended setup
for new projects, as of 2026).

## What's in here

```
public/            → the site itself (index.html, styles.css, script.js)
src/index.js        → the Worker: handles /api/search and /api/channel,
                       and serves everything else from /public
wrangler.jsonc       → tells Cloudflare how to build & deploy this Worker
package.json         → declares wrangler so "npx wrangler deploy" works
```

## 1. Get a free YouTube Data API key

1. https://console.cloud.google.com/ → create a project (free).
2. **APIs & Services → Library** → search "YouTube Data API v3" → **Enable**.
3. **APIs & Services → Credentials → Create Credentials → API key** → copy it.
4. Free daily quota: 10,000 units. Each keyword search costs ~200 units, so
   roughly 40-50 free searches/day before the 6-hour edge cache kicks in and
   starts saving you quota on repeat searches.

## 2. Push this folder to GitHub

Make sure these files sit at the **root** of your repo — not nested inside
another folder:

```
your-repo/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── script.js
├── src/
│   └── index.js
├── wrangler.jsonc
├── package.json
└── README.md
```

## 3. Deploy on Cloudflare

1. https://dash.cloudflare.com/ → **Workers & Pages → Create → Import a
   repository** (or "Connect to Git") → select your repo.
2. Cloudflare will detect `wrangler.jsonc` automatically. Leave the deploy
   command as `npx wrangler deploy`.
3. Click **Deploy**.

## 4. Add your API key as a secret

In the Worker's project page: **Settings → Variables and Secrets → Add**

- Name: `YOUTUBE_API_KEY`
- Value: *(paste your key)*
- Type: **Secret**

Then trigger a new deployment (push a commit, or use "Retry deployment") so
the Worker picks it up.

## 5. Connect your domain

**Settings → Domains & Routes → Add** → follow the DNS prompts. Free, and
Cloudflare issues the SSL certificate automatically.

## Adding ads later (AdSense)

Once live with real traffic, apply at https://www.google.com/adsense. Once
approved, add Google's snippet into `public/index.html`'s `<head>`.
