# AGENTS.md

This file gives coding agents a fast, reliable baseline for working in this repository.

## Project Scope

- `amaprice` is a Node.js CLI for Amazon price checks, tracking, and background collection.
- The repo also contains a marketing site in `website/` (Next.js).
- Live website: `https://amaprice.sh`
- Root runtime is CommonJS (`"type": "commonjs"`). `website/` is ESM.

## Key Paths

- `bin/cli.js`: CLI entrypoint (`amaprice` command)
- `src/commands/`: CLI command modules
- `src/worker.js`: long-running sync worker
- `src/collector/`: collector orchestration/state logic
- `test/`: Node built-in test suite (`node:test`)
- `supabase/migrations/`: SQL migrations
- `website/`: Next.js website app

## Setup

1. Use Node.js 20 or newer.
2. Install root dependencies:
   - `npm install`
3. For website work only:
   - `cd website && npm install`

## Common Commands

- Root tests: `npm test`
- One-off sync: `npm run sync`
- Worker loop: `npm run worker`
- Worker one-shot: `npm run worker:once`
- Collector start: `npm run collector:start`
- Collector run once: `npm run collector:once`
- Scrape analysis helper: `npm run analyze:scrape`

Website:

- Dev server: `cd website && npm run dev`
- Production build: `cd website && npm run build`
- Start built app: `cd website && npm run start`

## Environment Notes

- Primary env vars are documented in `README.md` under "Local/Worker Environment".
- For isolated development, point to your own Supabase project (`SUPABASE_URL` + `SUPABASE_KEY`).
- Do not hardcode secrets or service-role credentials in source files.

## Website Deploy Guardrails

- Vercel deploys from repo root using root `vercel.json` commands that run inside `website/` (`cd website && ...`).
- Keep `next`, `react`, and `react-dom` present in root `package.json` `devDependencies` so Vercel framework detection does not fail when root directory is the repository root.
- Keep `vercel.json` install command in this pattern:
  - `npm install --ignore-scripts --omit=prod && cd website && npm install`
  - Reason: this installs root dev deps for framework detection without triggering root `postinstall` (Playwright browser download), then installs website deps.
- Do not change install command to only `cd website && npm install`; that causes Vercel Next.js detection to fail in this monorepo layout.
- If you change this model (for example, Vercel Root Directory set to `website`), you must also update `vercel.json` install/build/dev commands accordingly.

## Coding Conventions

- Match existing style: CommonJS modules in root app code (`require`, `module.exports`).
- Keep command behavior in `src/commands/` and shared logic in reusable modules.
- Prefer small, focused changes over broad refactors.
- Add or update tests in `test/` when behavior changes.

## Validation Checklist

Before opening a PR or finalizing significant changes:

1. Run `npm test` at repo root.
2. If CLI behavior changed, run a quick smoke check:
   - `node bin/cli.js --help`
3. If website changed, run:
   - `cd website && npm run build`

## Agent Handoff

When handing off work, include:

1. What changed (files + behavior).
2. What was validated (tests/commands run).
3. Any remaining risks, assumptions, or follow-up tasks.
