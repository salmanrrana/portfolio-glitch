# Glitch Portfolio

A single-page personal portfolio for **Salman R Rana — Software Engineer**, built as a
full-viewport, scroll-driven "splash" experience around one hero video. As you scroll,
only the **sky** region of the video glitches (RGB-split, displacement, datamosh) while
the field, hills, and horses stay clean. Plain HTML/CSS/JS — no framework — hosted on
**Netlify**.

> **Status:** scaffold. The video pipeline, scroll engine, sky mask, WebGL glitch shader,
> and scroll narrative arrive in later tickets. Right now `index.html` renders a
> full-viewport placeholder hero so the deploy loop is proven end to end.

## Project layout

```
index.html              # single page; links src/styles.css + src/main.js (module)
src/
  styles.css            # base styles + full-viewport hero
  main.js               # ES-module entry point (bootstrap + ?debug hook)
public/assets/          # encoded video, poster, sky-mask (committed); raw .MOV is NOT
scripts/                # encode-video.sh (later ticket)
netlify.toml            # publish dir + cache headers (no build step)
```

## Run locally

No build step. Serve the repo root over HTTP (opening `index.html` via `file://` breaks
ES modules), then visit the printed URL.

```sh
# Option A — Node (no install; uses the `serve` package on demand)
npx serve .

# Option B — Python 3 (built in on most machines)
python3 -m http.server 8000
# then open http://localhost:8000
```

Append `?debug` to the URL (e.g. `http://localhost:8000/?debug`) to enable the debug
hook. The full live progress/scene overlay is wired up by the timeline-engine ticket.

## Deploy to Netlify

The site is static with **no build command** — `netlify.toml` sets `publish = "."`, so a
`git push` (or `netlify deploy`) goes straight live. The `netlify` CLI is installed.

### First-time setup

1. **Log in** (opens a browser to authorize):
   ```sh
   netlify login
   ```
2. **Link or create a site** from the repo root:
   ```sh
   netlify init      # create a new site, or...
   netlify link      # ...connect to an existing Netlify site
   ```

### Deploy

```sh
# Draft deploy to a preview URL (confirms the publish dir is correct):
netlify deploy

# Production deploy:
netlify deploy --prod
```

### Or: connect the git repo in the Netlify UI (recommended for "git push → live")

1. Push this repo to GitHub/GitLab.
2. In the Netlify dashboard: **Add new site → Import an existing project** → pick the repo.
3. Build command: **leave empty**. Publish directory: **`.`** (already set in `netlify.toml`).
4. Deploy. Every subsequent `git push` to the connected branch auto-deploys.

> If the CLI is not authenticated in this environment, use the UI path above — no
> credentials are assumed here.

## Caching

`netlify.toml` sends `Cache-Control: max-age=0, must-revalidate` for everything by
default (so HTML/CSS/JS updates appear immediately) and a 1-year immutable cache for
`/public/assets/*` (the encoded media), keeping the experience fast on repeat visits.

## Notes

- The raw source video (`*.MOV`, ~60 MB) is **gitignored** and never committed — it is
  transcoded into web-optimized formats in `public/assets/` by `scripts/encode-video.sh`.
