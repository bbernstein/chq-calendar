# Chautauqua Calendar Frontend

A Vite + Preact static site for the Chautauqua Institution event calendar.

## Development

Run these from the **repo root**, not from this directory. The project is an
npm workspaces monorepo with a single root lockfile; `npm install` in here
resolves against `frontend/package.json`'s semver ranges instead of that
lockfile, which is how an unpinned `@preact/preset-vite` gets installed and
serves a blank page.

```bash
npm ci
npm run dev --workspace=frontend
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Build

```bash
npm run build
```

Output is written to `out/` as static HTML/CSS/JS files, deployed to S3 + CloudFront.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Type-check, lint, then build |
| `npm run preview` | Preview production build locally |
| `npm run validate` | Run type-check + lint |
| `npm run type-check` | TypeScript checking (`tsc --noEmit`) |
| `npm run lint` | ESLint |

## Stack

- **Vite 7** — build tool
- **Preact 10** — UI library
- **TypeScript** — type safety
- **Tailwind CSS 4** — styling
