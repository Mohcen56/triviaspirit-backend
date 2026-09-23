# TriviaSpirit API

![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-4169E1?logo=postgresql&logoColor=white)
[![CI](https://github.com/Mohcen56/triviaspirit-backend-Nest.js/actions/workflows/ci.yml/badge.svg)](https://github.com/Mohcen56/triviaspirit-backend-Nest.js/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Mohcen56/triviaspirit-backend-Nest.js/branch/main/graph/badge.svg)](https://codecov.io/gh/Mohcen56/triviaspirit-backend-Nest.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> A production-minded NestJS and TypeScript API for a turn-based trivia platform.

[Live API health](https://api.triviaspirit.com/health) · [NestJS source on GitHub](https://github.com/Mohcen56/triviaspirit-backend-Nest.js) · [Local health check](http://localhost:8000/health)

## At a glance

TriviaSpirit is a trivia platform with authentication, user-generated content, turn-based games, subscriptions, media uploads, and an admin dashboard.

This repository is the current backend: a modular NestJS application that serves the frontend, uses PostgreSQL as its source of truth, and keeps compatibility with the existing production data model.

### What this project demonstrates

- Designing a modular REST API with NestJS, TypeScript, DTO validation, guards, interceptors, and domain services.
- Migrating a live backend from Django while preserving users, tokens, database tables, routes, and response contracts.
- Building secure authentication with Django-compatible PBKDF2 passwords, token rotation, logout revocation, password reset, Google OAuth, and throttling.
- Implementing server-controlled turn-based gameplay with persisted question boards and validated round completion.
- Handling signed payment webhooks idempotently, including replay protection and entitlement updates.
- Shipping operational discipline: explicit migrations, production configuration validation, health/readiness endpoints, CI, and regression tests.

## Legacy Django showcase

The public product showcase and some older screenshots describe the **legacy Django version** of TriviaSpirit. That showcase is useful for seeing the product concept and UI, but it is not the current backend implementation and should not be used to evaluate the API architecture.

The current backend is this repository: **[TriviaSpirit NestJS Backend](https://github.com/Mohcen56/triviaspirit-backend-Nest.js)**. Recruiters can verify the implementation directly in the source, CI workflow, tests, migrations, and live health endpoint above.

The frontend is maintained separately and can be pointed at this API with `BACKEND_API_URL` and `NEXT_PUBLIC_API_BASE_URL`.

## Architecture

```text
Frontend
   │
   ▼
NestJS controllers
   │  DTO validation · authentication · throttling · upload limits
   ▼
Domain services
   │  auth · content · gameplay · payments · media
   ▼
TypeORM entities and versioned migrations
   │
   ├── PostgreSQL / Neon
   ├── Cloudflare R2 media storage
   └── Lemon Squeezy · Google OAuth · ZeptoMail
```

The application is organized by domain under [`src/`](src/):

| Area | Responsibility |
| --- | --- |
| [`auth`](src/auth) | Registration, login, Google OAuth, profiles, avatars, password reset, logout |
| [`content`](src/content) | Collections, categories, questions, saves, likes, and ownership rules |
| [`gameplay`](src/gameplay) | Turn-based games, question boards, rounds, stats, and history |
| [`payments`](src/payments) | Checkout, signed webhooks, replay protection, and payment history |
| [`media`](src/media) | Validated image processing, local storage, and Cloudflare R2 storage |
| [`database`](src/database) | Django-compatible entities, data-source configuration, and migrations |
| [`admin`](src/admin) | AdminJS dashboard with PostgreSQL-backed sessions |

## API surface

| Prefix | Features |
| --- | --- |
| `/api/auth/*` | Authentication, profiles, avatars, password changes, and password reset |
| `/api/content/*` | Collections, official/custom categories, questions, saves, and likes |
| `/api/gameplay/*` | Games, available questions, turn completion, stats, and history |
| `/api/payments/*` | Checkout, signed webhooks, and payment history |
| `/health` | Liveness check for deployment platforms |
| `/ready` | Database-backed readiness check |
| `/admin` | Protected AdminJS dashboard for staff and superusers |

## Engineering highlights

### Compatibility-first migration

NestJS reads the existing PostgreSQL database instead of creating a parallel schema. The compatibility layer preserves:

- Django table names and relationships.
- Django PBKDF2 password hashes.
- 40-character DRF authentication tokens.
- Existing frontend routes and response shapes.
- Existing users, categories, games, and payment history.

NestJS-owned changes are isolated in explicit migrations under [`src/database/migrations`](src/database/migrations). Production uses `DATABASE_SYNCHRONIZE=false`, so schema changes are reviewable and repeatable.

### Secure authentication

- Strong production secret validation.
- Case-insensitive email uniqueness.
- Password and token rotation after password changes and resets.
- Explicit logout token revocation.
- Google identity linking with provider-ordering safeguards.
- PostgreSQL-backed authentication throttling that survives restarts.
- HttpOnly admin sessions stored in PostgreSQL rather than process memory.

### Turn-based game integrity

Gameplay is explicitly turn-based. Each game receives a persisted question board, and round completion accepts only questions from that board. This prevents clients from submitting arbitrary question IDs and keeps the game state verifiable on the server.

### Reliable payments

- Lemon Squeezy webhook signatures are checked in every environment.
- Webhook bodies are fingerprinted transactionally for exact replay protection.
- Payment and entitlement updates are handled with per-user locking.
- Provider amounts are stored with integer minor-unit precision for reliable billing logic.

### Media pipeline

Uploads are size-limited, MIME-validated, processed with Sharp, resized, converted to WebP, and cleaned up after failed requests. R2 objects follow the shared Django-compatible layout:

```text
media/avatars/<id>.webp
media/categories/<id>.webp
media/questions/<id>.webp
media/answers/<id>.webp
```

The database stores the logical key, while the API returns the public media URL.

## Run locally

### Requirements

- Node.js 20 or newer
- npm
- PostgreSQL or a Neon PostgreSQL database

### Setup

```powershell
Copy-Item .env.example .env
npm ci
```

Configure at least these values in `.env`:

```env
NODE_ENV=development
DATABASE_URL=your-postgresql-url
DATABASE_SSL=true
DATABASE_SYNCHRONIZE=false
DATABASE_MIGRATIONS_RUN=false
APP_SECRET=a-long-random-secret
FRONTEND_URL=http://localhost:3000
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

Run the migrations and start the API:

```powershell
npm run migration:run
npm run start:dev
```

Verify the server at <http://localhost:8000/health>. The AdminJS dashboard is available at <http://localhost:8000/admin> for an active staff or superuser account.

Never commit `.env`, enable `DATABASE_SYNCHRONIZE` against production, or paste production credentials into issues, logs, or documentation.

## Database migrations

Inspect and run migrations explicitly:

```powershell
npm run migration:show
npm run migration:run
```

The safe production pattern is:

1. Back up the database.
2. Review the generated SQL and the migration `down` method.
3. Run migrations as a deployment step.
4. Start the new application process only after migrations succeed.

`DATABASE_MIGRATIONS_RUN=false` is intentional: it prevents multiple application instances from racing to migrate at startup.

## Production deployment

The repository includes a [`Procfile`](Procfile) for Heroku:

```text
release: npm run migration:run:compiled
web: npm run start:prod
```

Set production values in the hosting provider’s environment settings, not in Git:

```env
NODE_ENV=production
APP_SECRET=<long-random-secret>
ADMIN_COOKIE_SECRET=<different-long-random-secret>
DATABASE_URL=<production-postgresql-url>
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=true
DATABASE_SYNCHRONIZE=false
DATABASE_MIGRATIONS_RUN=false
FRONTEND_URL=https://your-frontend-domain.com
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
TRUST_PROXY=1
```

For R2-backed media, configure all five variables together:

```env
CLOUDFLARE_R2_BUCKET=<bucket-name>
CLOUDFLARE_R2_ACCESS_KEY=<access-key>
CLOUDFLARE_R2_SECRET_KEY=<secret-key>
CLOUDFLARE_R2_BUCKET_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
CLOUDFLARE_R2_CUSTOM_DOMAIN=https://<public-media-domain>
```

`CLOUDFLARE_R2_CUSTOM_DOMAIN` must be the public domain only. Do not append the bucket name or `/media`; the application adds the `media/` prefix when building object paths.

After deployment, verify:

```text
GET https://your-api-domain.com/health  -> 200
GET https://your-api-domain.com/ready   -> 200 when PostgreSQL is reachable
```

## Testing and quality checks

```powershell
npm run format:check
npm run lint
npm run build
npm test
npm run test:e2e
```

The test suite covers authentication compatibility, DTO validation, ownership and visibility rules, turn-based gameplay, token rotation, signed webhook handling and replay protection, media URL behavior, and durable throttling.

End-to-end tests use an isolated PostgreSQL database:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/triviaspirit_test'
npm run test:e2e
```

GitHub Actions runs formatting, linting, build checks, unit tests, integration tests, and a production dependency audit.

## Selected design decisions

| Decision | Reason |
| --- | --- |
| PostgreSQL migrations instead of synchronize | Reviewable, repeatable schema changes in production |
| Server-controlled question boards | Prevents clients from submitting arbitrary gameplay questions |
| Transactional webhook fingerprints | Makes exact webhook retries harmless |
| Integer payment minor units | Avoids floating-point billing errors |
| R2 object storage | Prevents uploaded media from disappearing on ephemeral dynos |
| PostgreSQL-backed throttling and admin sessions | Keeps security state durable across restarts and instances |
| Compatibility with Django data | Enables an incremental migration without a destructive rewrite |

## License

Released under the [MIT License](LICENSE).
