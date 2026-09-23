# TriviaSpirit NestJS Backend

[![CI](https://github.com/Mohcen56/triviaspirit-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/Mohcen56/triviaspirit-backend/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Mohcen56/triviaspirit-backend/branch/main/graph/badge.svg)](https://codecov.io/gh/Mohcen56/triviaspirit-backend)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Production API health](https://api.triviaspirit.com/health) | [Local API health](http://localhost:8000/health)

TriviaSpirit is a NestJS and TypeScript backend for a turn-based trivia game. It provides the REST API used by the frontend, persists data in PostgreSQL, and preserves compatibility with the existing Django database, routes, response shapes, PBKDF2 passwords, and DRF authentication tokens.

- `/api/auth/*` - email/password auth, Google OAuth, profiles, avatars, logout, and password reset
- `/api/content/*` - collections, official/custom categories, questions, saves, and likes
- `/api/gameplay/*` - turn-based games, persisted question boards, round completion, stats, and history
- `/api/payments/*` - Lemon Squeezy checkout, signed webhooks, and payment history

## Backend architecture

NestJS is the application runtime. Controllers keep the existing frontend contract and validate writes with DTOs. Domain services enforce ownership, private-category visibility, turn-based gameplay rules, and payment state. TypeORM entities map to the existing Django-compatible tables instead of creating parallel application tables.

```text
Next.js client
    -> NestJS controllers + validated DTOs
        -> auth/content/gameplay/payment services
            -> TypeORM entities and migrations
                -> PostgreSQL (Django-compatible schema)
```

Compatibility-sensitive choices include:

- `auth_user`, `authentication_userprofile`, and `authtoken_token` retain their Django names and field shapes.
- Django PBKDF2 hashes and 40-character DRF tokens remain readable.
- Password changes and resets rotate the database token; `POST /api/auth/logout` revokes it.
- Custom private or unapproved categories are visible only to their owner or staff.
- Gameplay is turn-based: each game receives a persisted question board, and round completion accepts only questions from that board.
- Lemon Squeezy signatures are required in every environment. Successfully processed webhook bodies are fingerprinted transactionally so an exact replay has no second effect.
- Authentication throttles are stored in PostgreSQL, making them durable across restarts and application instances. A dedicated Redis throttler store is the recommended next step at high request volume.

## Requirements

- Node.js 20 or newer
- npm
- An accessible PostgreSQL database (the project uses Neon)

## Quick start with Neon

Create your local environment file from the committed template:

```powershell
Copy-Item .env.example .env
```

Configure `.env`:

```env
DATABASE_URL=your-neon-postgresql-url
DATABASE_SSL=true
DATABASE_SYNCHRONIZE=false
DATABASE_MIGRATIONS_RUN=false
APP_SECRET=a-long-random-secret
```

Never commit `.env`; it is intentionally ignored by Git. Install and start the API:

```powershell
npm ci
npm run migration:run
npm run start:dev
```

Check the API at <http://localhost:8000/health>.

Keep `DATABASE_SYNCHRONIZE=false` for the existing database. Never enable schema synchronization against production.

## Versioned database migrations

Run migrations as a separate deployment step before starting new application instances:

```powershell
npm run migration:show
npm run migration:run
```

`DATABASE_MIGRATIONS_RUN=false` is the safe default so multiple replicas do not race to migrate. Generate future changes with `npm run migration:generate`, inspect the SQL, test it against a recent backup, and commit the migration with its entity change. Use `npm run migration:revert` only after reviewing the migration's `down` method and the affected production data.

The NestJS-owned migrations add the durable authentication throttle/replay tables,
Google identity and provider-ordering columns, the case-insensitive email and
played-question uniqueness safeguards, admin session storage, and the payment
minor-unit column. Existing Django tables are treated as the baseline and are not
recreated. The email and played-question migrations deliberately preflight existing
duplicates and must be reviewed against a backup before deployment.

## Admin dashboard

AdminJS is available at <http://localhost:8000/admin>. Sign in with an active user whose `is_staff` or `is_superuser` flag is enabled. It uses the same email and Django-compatible password as the API.

Set a dedicated session secret in production. If omitted, the dashboard falls back to `APP_SECRET`:

```env
ADMIN_COOKIE_SECRET=a-long-random-admin-session-secret
```

Authentication tokens are excluded from the dashboard. Engagement, gameplay, payment, and subscription records are read-only.

## Use the existing Django database

Point `DATABASE_URL` at the same PostgreSQL database used by Django, keep `DATABASE_SYNCHRONIZE=false`, back it up, and run the versioned migrations. Existing users, tokens, categories, games, and payment history then remain available without a data copy. Before changing historical payment amounts, audit whether the existing `amount` values are provider minor units or API major units; the application records new webhook amounts in both `amount` (major units) and `amount_minor` (integer minor units).

Production build:

```powershell
npm ci
npm run migration:run
npm run build
npm run start:prod
```

## Run with the frontend

Start this repository with `npm run start:dev`. In the separate frontend repository, set:

```env
# Used by Next.js server code. It does not reach the browser bundle.
BACKEND_API_URL=http://127.0.0.1:8000

# Used by the browser only to turn relative media paths into public URLs.
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then start the frontend and open <http://localhost:3000>.

## Deploy the API to Railway

This repository is ready for a Railway web service. It uses the platform-provided `PORT` and exposes `GET /health` for the deployment health check.

1. Create a Railway project and choose **Deploy from GitHub repo**. Select this repository and keep the service's **Root Directory** at the repository root.
2. In the service settings, set these commands:

   ```text
   Build Command:      npm ci && npm run build
   Pre-Deploy Command: npm run migration:run
   Start Command:      npm run start:prod
   Healthcheck Path:   /health
   ```

   The migration runs before the new server starts, so a failed migration prevents a partial application deploy. Do not enable `DATABASE_MIGRATIONS_RUN` as well; one migration mechanism is enough.
3. Add the production variables from `.env.example` in Railway. At minimum, configure:

   ```env
   NODE_ENV=production
   DATABASE_URL=your-production-postgresql-url
   DATABASE_SSL=true
   DATABASE_SYNCHRONIZE=false
   DATABASE_MIGRATIONS_RUN=false
   APP_SECRET=a-long-random-secret
   ADMIN_COOKIE_SECRET=a-different-long-random-secret
   FRONTEND_URL=https://www.your-frontend-domain.com
   CORS_ALLOWED_ORIGINS=https://www.your-frontend-domain.com
   MEDIA_PUBLIC_URL=https://api.your-api-domain.com/media
   ```

   Also copy any integrations you use: Cloudflare R2, Google OAuth, Lemon Squeezy, and ZeptoMail. Keep all secrets in Railway variables—never in Git.
4. Generate a Railway public domain or attach your API domain. Verify `https://your-api-domain.com/health` returns `200` before pointing the frontend at it.
5. In the frontend deployment variables, set both values to that public API origin and redeploy the frontend:

   ```env
   BACKEND_API_URL=https://your-api-domain.com
   NEXT_PUBLIC_API_BASE_URL=https://your-api-domain.com
   ```

6. Update third-party callback URLs: Lemon Squeezy webhook to `https://your-api-domain.com/api/payments/webhook/`; Google OAuth's browser origin and redirect settings to your frontend domain.

For local media, Railway containers are ephemeral. Use Cloudflare R2 in production, or attach durable storage and set `MEDIA_ROOT` plus `MEDIA_PUBLIC_URL` accordingly.

## Media storage

Uploads use `media/` in local development. For Cloudflare R2, configure all values below:

```env
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_ACCESS_KEY=
CLOUDFLARE_R2_SECRET_KEY=
CLOUDFLARE_R2_BUCKET_ENDPOINT=
CLOUDFLARE_R2_CUSTOM_DOMAIN=
```

The service validates uploads, resizes large images, and stores them as WebP. R2
objects use the shared `media/` prefix, so a question image is stored at
`media/questions/<id>.webp` and is served from
`https://your-r2-domain.com/media/questions/<id>.webp`.

## Optional integrations

Google login requires `GOOGLE_OAUTH_CLIENT_ID`.

Lemon Squeezy checkout and webhooks require:

```env
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_WEBHOOK_SECRET=
LEMONSQUEEZY_VARIANT_ID=
```

Set the webhook URL to `/api/payments/webhook/`. `LEMONSQUEEZY_WEBHOOK_SECRET` is mandatory whenever payment API settings are present, and every webhook signature is checked regardless of `NODE_ENV`.

ZeptoMail password-reset email requires `ZEPTOMAIL_API_KEY`, `ZEPTOMAIL_API_ENDPOINT`, and `DEFAULT_FROM_EMAIL`. Without an API key, development mode logs the reset URL in the backend terminal.

## Verification

```powershell
npm run format:check
npm run lint
npm run build
npm test
npm run test:e2e
```

Integration tests require an isolated PostgreSQL database:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/triviaspirit_test'
npm run test:e2e
```

The suite covers registration/login/authentication, Django password and token compatibility, ownership and private visibility, game creation and round completion, token rotation/logout, webhook signatures and replay handling, DTO validation, and durable throttling. GitHub Actions provisions PostgreSQL and runs formatting, linting, build, unit coverage, integration tests, and a production dependency audit.

## Common problems

- `DATABASE_URL must be configured`: create `.env` from `.env.example`.
- PostgreSQL connection refused: confirm the database is reachable and the URL is correct.
- Existing hosted database rejects the connection: set `DATABASE_SSL=true`.
- Frontend returns `Proxy request failed`: confirm the API is running on port 8000 and `NEXT_PUBLIC_API_BASE_URL` points to it.
- Existing R2 images do not load: set `CLOUDFLARE_R2_CUSTOM_DOMAIN` to the public bucket or custom-domain base URL.
- Authentication requests fail because `security_auth_rate_limit` is missing: run `npm run migration:run` before starting the new build.

## License

Released under the [MIT License](LICENSE).
