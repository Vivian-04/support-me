# Contributing to SupportMe

Thank you for your interest in contributing to SupportMe. This project is built to support creator tipping and donations with a backend-first open source strategy.

## How to Contribute

1. Fork the repository.
2. Create a descriptive branch name, e.g. `feature/creator-dashboard` or `fix/api-validation`.
3. Make small, focused changes.
4. Add or update documentation when you add features.
5. Commit with clear messages.
6. Open a pull request with a summary and motivation.

## Repository Structure

- `frontend/` — Next.js client for public pages and donation flows.
- `backend/` — Express API with Prisma and PostgreSQL support.
- `docs/` — Architecture, design, and contribution documentation.
- `contracts/` — Legacy contract examples; not required for the current backend-first roadmap.

## Development Setup

### Backend

See [`backend/docs/CONFIGURATION.md`](backend/docs/CONFIGURATION.md) for the
backend environment variables grouped by service, including defaults and
local, staging, and production guidance.

```bash
cd backend
npm install
cp .env.example .env
# update DATABASE_URL in .env
npm run prisma:generate
npm run dev
```

### Frontend

```bash
cd frontend
npm install
# create frontend/.env.local with required env vars
npm run dev
```

### Auth providers (optional)

Wallet sign-in only needs `JWT_SECRET`. To exercise the Twitter/X OAuth and
magic-link flows locally, add the relevant variables to `backend/.env` and
restart the server:

- **Twitter/X OAuth**: `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, and
  `TWITTER_REDIRECT_URI`. Register an app at
  [developer.x.com](https://developer.x.com) and set its callback URL to
  `http://localhost:3000/auth/twitter/callback` (localhost is allowed over HTTP
  for development).
- **Magic link**: `RESEND_API_KEY` (plus optional `EMAIL_FROM` and `APP_URL`).
  If `RESEND_API_KEY` is unset, the magic link is printed to the backend log
  instead of being emailed — the quickest way to test the flow locally.

Both methods are optional: the app runs without them, and the endpoints return
`503` when a provider is unconfigured. See
[`docs/authentication.md`](docs/authentication.md) for the full setup steps,
required environment variables, and curl walkthroughs.

## What We Want

- Clean, well-documented APIs
- Stable database schema and migrations
- Accessible frontend flows
- Minimal contract dependencies for now
- Tests and validation for new features

## Best Practices

- Keep user flows simple and reliable.
- Prefer explicit API responses and error handling.
- Keep architecture documentation updated.
- Avoid adding contract complexity unless it is required by the feature.

## Reporting Issues

If you find a bug or want to propose a feature, open an issue with:
- Summary of the problem or feature
- Steps to reproduce / expected behavior
- Any relevant screenshots or logs
