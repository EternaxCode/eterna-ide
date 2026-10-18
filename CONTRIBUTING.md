# Contributing to Eterna IDE

Use Node.js 24.2+ and Git. macOS is the supported interactive-terminal platform; CI also exercises the core and browser flows on Linux.

```sh
npm ci
npm test
npm run check
npm run build
npx playwright install chrome
npm run test:e2e
```

Open an issue with the problem and expected behavior, then submit a focused pull request. Include a regression test for data preservation, authentication, sharing scope, or process lifecycle changes. Run `npm run benchmark` for performance changes and describe the fixture and environment; do not claim model inference speedups from UI measurements.

Never commit `.data`, credentials, login URLs, private source snapshots, or real model transcripts. Use synthetic fixtures. Live provider smoke tests are opt-in and consume your own subscription allowance. Provider integrations must retain official authentication and approval boundaries.
