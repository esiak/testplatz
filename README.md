# bgtsearch

Find Einbürgerungstest dates near you in Bavaria. A static Preact site served from GitHub Pages at
<https://esiak.github.io/testplatz/>.

```sh
npm ci
npm run dev        # local dev server
npm run typecheck
npm test
npm run build      # outputs dist/
```

## Operator prerequisites

Before merging to `main` triggers the first deploy:

- The repository `esiak/testplatz` is **public**.
- **Settings → Pages → Build and deployment → Source** is set to **GitHub Actions**.
- Workflows are allowed to push to `main` (branch protection / rulesets must let the workflow's
  `GITHUB_TOKEN` push; later stories commit `data/` from `pipeline.yml`).
