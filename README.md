# Snap! Uploader

Upload images, audio, sprites and custom blocks to Snap! projects — without opening a browser tab.

## Local development

```bash
npm install
npm run dev          # starts proxy on :3000 + watches Tailwind
# open http://localhost:3000
```

## Deploy to GitHub Pages

1. Push to `main` — GitHub Actions builds the CSS and deploys automatically.
2. Enable Pages in repo **Settings → Pages → Source: GitHub Actions**.

## How it works

- **Local**: `proxy.js` (Express) forwards `/api/*` to `snap.berkeley.edu` to bypass CORS. Tailwind watches `input.css`.
- **Production**: `snap-api.js` auto-detects GitHub Pages and routes through `corsproxy.io`.
- No framework, no bundler — just HTML + ES Modules + Tailwind CSS.
