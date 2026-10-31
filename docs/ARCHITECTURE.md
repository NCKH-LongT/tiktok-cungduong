# Architecture

## Runtime

The Next.js app serves dashboard, control panel and OBS overlay. NestJS owns authentication, tenant authorization, data writes, simulation, and Socket.IO. PostgreSQL stores accounts, channels, events, gifts and configuration. Redis carries connector events and BullMQ speech jobs. Separate TikTok and AI workers prevent network/API work from blocking HTTP requests. Nginx routes web and Socket.IO traffic.

```text
TikTok worker → Redis pub/sub → Nest event validation → PostgreSQL → Socket.IO → PixiJS overlay
Simulator ────────────────────→ same event validation → PostgreSQL → Socket.IO → PixiJS overlay
                                  └→ BullMQ → AI worker → Gemini / Google TTS → Redis → Socket.IO
```

Each channel has one owner. Every private route checks ownership in the backend. OBS receives a random revocable token stored only as SHA-256 hash. Auth sessions also store only token hashes. Simulator events carry `source=simulator`; public analytics and leaderboard exclude them. An explicit simulator AI option sends the event through BullMQ while retaining that source marker.

The worker currently uses the community `tiktok-live-connector` adapter in explicit `tiktok` mode. TikTok event availability and connection behavior depend on upstream access. The worker uses a Redis lock per channel and reconnects through polling. No `viewer.leave` is fabricated; the overlay expires inactive characters after a configurable TTL.

The scene uses PixiJS geometry and animated transitions. Its character graphics are procedural until licensed sprite assets are available. The same state machine can later drive sprite sheets. A seat is allocated once per viewer and released on leave or inactivity. The overlay serializes speech playback, falls back to browser Vietnamese speech synthesis when Google TTS is unavailable, and lowers YouTube IFrame Player volume during speech.

## Security and operations

Passwords use Argon2id. Sessions are HTTP-only, SameSite=Lax cookies, secure on production. Login is rate limited in Redis and verifies Cloudflare Turnstile through Siteverify when configured. API mutations reject disallowed browser origins. Database and Redis have no public ports in Compose. The admin bootstrap reads environment variables and never logs credentials.

The initial release has one API instance. Multi-instance Socket.IO needs a Redis adapter; the current pub/sub feed reaches each instance, but room state is local. Docker Compose is intentionally a single-host deployment.
