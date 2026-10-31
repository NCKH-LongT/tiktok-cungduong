# TikTok Cúng Dường AI Live

Monorepo for a multi-LIVE dashboard, event pipeline and OBS temple overlay. The current implementation contains a usable simulator and initial live connector; read [progress](docs/PROGRESS.md) before production use.

## Local setup

Requirements: Node 22, npm 10, Docker Compose.

1. Copy `.env.example` to `.env` and set strong `POSTGRES_PASSWORD`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` (16+ characters). Keep `.env` out of Git. Existing `.env.gitignore` can be used as a private source of credentials but is ignored by Git.
2. Run `npm ci`, then `npm run build`.
3. Run `docker compose --env-file .env up -d --build --wait`.
4. Open `http://localhost:8080` and sign in with the bootstrap admin.
5. Create a LIVE channel, rotate an overlay token, open the OBS URL, and use the Simulator tab to test events.

The default `TIKTOK_CONNECTOR_MODE=simulator` never contacts TikTok. Switch to `tiktok` only after verifying the community adapter and obtaining any required signing access. AI comment answers require `GEMINI_API_KEY`. Google TTS requires a service-account JSON in `./secrets` and `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/<filename>.json` in the Compose environment. Voice ID, speaking rate and pitch are configured per LIVE in Voice & Audio; the available Vietnamese voice IDs come from [Google's voice list](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types). Without Google credentials, the overlay uses the browser's Vietnamese speech synthesis when available; voice quality depends on the browser. The Simulator tab can explicitly test AI without counting the event as real LIVE activity.

YouTube music uses the official IFrame Player API and stays visible in the overlay. Autoplay can be blocked; use the player button or OBS Browser Source interaction to start it. Audio from the overlay is what OBS captures. Use music you have permission to play.

## VPS and CI/CD

On Ubuntu, install Docker Engine and the Compose plugin, configure DNS, and place a private `.env` on the server. Mount an Nginx TLS configuration and Let's Encrypt certificates using `infrastructure/nginx/https.conf.example` as the template. Change `PUBLIC_APP_URL` and `PUBLIC_OVERLAY_URL` to the HTTPS domain. The Compose default listens on HTTP port 8080 for local verification.

Jenkins runs install, tests, typecheck, build and Docker build. Deploy is opt-in on `main` through parameter `DEPLOY` and a Jenkins **secret file** credential with ID `cungduong-env`. The Jenkins agent needs Docker access and the project checkout must be on the target host. Keep secret JSON files in `./secrets` on that host.

PostgreSQL and Redis use named volumes. Back up with `docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql` from a shell where those variables are set; encrypt and store backups outside the host. Test restore into a separate database. Do not copy database or Redis ports to public interfaces.

## Developer commands

`npm run db:generate` generates Prisma client. `npm run db:migrate` applies checked-in migrations. `npm run db:bootstrap` creates the admin from environment variables. `npm test` runs unit tests. `npm run typecheck` verifies TypeScript. `npm run test:smoke` exercises the running stack from login through simulator and token revoke; set `SMOKE_BASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the shell. With a configured Gemini worker, `npm run test:ai-smoke` checks the simulator → Gemini → speech socket path. See [architecture](docs/ARCHITECTURE.md) and [plan](docs/IMPLEMENTATION_PLAN.md).
