# TriviaSpirit NestJS backend

Standalone NestJS API for TriviaSpirit. It replaces the original Django REST backend while preserving the routes, response shapes, database tables, Django PBKDF2 passwords, and DRF authentication tokens used by the existing frontend and database.

The NestJS API keeps the routes and JSON shapes used by the current Next.js frontend, including:

- `/api/auth/*` — email/password auth, Google OAuth, profiles, avatars, and password reset
- `/api/content/*` — collections, official/custom categories, questions, saves, and likes
- `/api/gameplay/*` — games, question boards, round completion, stats, and history
- `/api/payments/*` — Lemon Squeezy checkout, webhooks, and payment history

It also maps to the existing Django table names and understands Django PBKDF2 passwords plus DRF `Authorization: Token ...` records. You can switch the API over without resetting accounts or rewriting the frontend.

## Requirements

- Node.js 20 or newer
- npm
- An accessible PostgreSQL database (the project uses Neon)

## Quick start with Neon

Create your local environment file from the committed template:

```powershell
Copy-Item .env.example .env
```

Then configure `.env` with the Neon connection string and new application secrets:

```env
DATABASE_URL=your-neon-postgresql-url
DATABASE_SSL=true
DATABASE_SYNCHRONIZE=false
APP_SECRET=a-long-random-secret
```

Never commit `.env`; it is intentionally ignored by Git.

Install and start the API from the repository root:

```powershell
npm ci
npm run start:dev
```

Check the API at <http://localhost:8000/health>.

Keep `DATABASE_SYNCHRONIZE=false` for the existing database. Never enable schema synchronization against production.

## Admin dashboard

AdminJS is available at <http://localhost:8000/admin>. Sign in with an active user whose `is_staff` or `is_superuser` flag is enabled. It uses the same email and Django-compatible password as the main app.

Set a dedicated session secret in production. If it is omitted, the dashboard falls back to `APP_SECRET`:

```env
ADMIN_COOKIE_SECRET=a-long-random-admin-session-secret
```

Users, profiles, collections, categories, and questions are manageable from the dashboard. Authentication tokens are excluded, while engagement, gameplay, payment, and subscription records are read-only.

## Use the existing Django database

Set the existing database connection in `.env`:

```env
DATABASE_URL=the-same-postgresql-url-used-by-Django
DATABASE_SSL=true
DATABASE_SYNCHRONIZE=false
APP_SECRET=a-long-random-secret
```

Because the entity mappings use the original Django table and column names, existing users, tokens, categories, games, and payment history remain available.

Start the API:

```powershell
npm ci
npm run start:dev
```

Production build:

```powershell
npm run build
npm run start:prod
```

## Run with the frontend

In terminal 1:

```powershell
npm run start:dev
```

In terminal 2, open your separate frontend repository and configure its `.env.local`:

```powershell
cd path/to/frontend
```

Set this in `frontend/.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then run:

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>.

## Media storage

Uploads go to `media/` in local development. For Cloudflare R2, configure all of these values:

```env
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_ACCESS_KEY=
CLOUDFLARE_R2_SECRET_KEY=
CLOUDFLARE_R2_BUCKET_ENDPOINT=
CLOUDFLARE_R2_PUBLIC_URL=
```

The service validates uploads, resizes large images, and stores them as WebP.

## Optional integrations

Google login requires `GOOGLE_OAUTH_CLIENT_ID`.

Lemon Squeezy requires:

```env
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_WEBHOOK_SECRET=
LEMONSQUEEZY_VARIANT_ID=
```

Set the webhook URL to `/api/payments/webhook/`. Signature checks are mandatory when `NODE_ENV=production`.

ZeptoMail password-reset email requires `ZEPTOMAIL_API_KEY`, `ZEPTOMAIL_API_ENDPOINT`, and `DEFAULT_FROM_EMAIL`. Without an API key, development mode logs the reset URL in the backend terminal.

## Verification commands

```powershell
npm run format:check
npm run build
npm test
npm run lint
```

The same checks run automatically in GitHub Actions for pushes to `main` and for pull requests.

## Common problems

- `DATABASE_URL must be configured`: create `.env` from `.env.example`.
- PostgreSQL connection refused: confirm the Neon database is reachable and `DATABASE_URL` is correct.
- Existing hosted database rejects the connection: set `DATABASE_SSL=true`.
- Frontend returns `Proxy request failed`: confirm the NestJS API is running on port 8000 and `NEXT_PUBLIC_API_BASE_URL` points to it.
- Existing R2 images do not load: set `CLOUDFLARE_R2_PUBLIC_URL` to the public bucket/custom-domain base URL.
