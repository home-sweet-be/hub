# homesweet-hub

Hub built with Vite + React (JSX). Deployed on Vercel.

## Dev

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
npm run preview  # serve built output locally
npm run lint
```

## Deploy

Push to GitHub then import the repo in Vercel. The included `vercel.json` rewrites all routes to `index.html` (SPA mode). Default Vercel settings work:

- Framework: Vite
- Build command: `npm run build`
- Output dir: `dist`
