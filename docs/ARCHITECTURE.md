# Architecture

## Runtime

The Next.js app serves dashboard, control panel and OBS overlay. NestJS owns authentication, tenant authorization, data writes, simulation, and Socket.IO. PostgreSQL stores accounts, channels, events, gifts and configuration. Redis carries connector events and BullMQ speech jobs. Separate TikTok and AI workers prevent network/API work from blocking HTTP requests. Nginx routes web and Socket.IO traffic.

Dashboard analytics aggregates events from successful worker sessions that share the same TikTok room ID. Failed connection attempts do not replace the last successful broadcast's statistics. The latest `ROOM_USER` event supplies the reported current and cumulative viewer counts. Like event count and the summed `count` field are shown separately as like actions and hearts. Simulator rows are excluded.

```text
TikTok worker → Redis pub/sub → Nest event validation → PostgreSQL → Socket.IO → PixiJS overlay
Simulator ────────────────────→ same event validation → PostgreSQL → Socket.IO → PixiJS overlay
                                  └→ BullMQ → AI worker → Gemini / Google TTS → Redis → Socket.IO
```

Each channel has one owner. Every private route checks ownership in the backend. OBS receives a random revocable token stored only as SHA-256 hash. Auth sessions also store only token hashes. Simulator events carry `source=simulator`; public analytics and leaderboard exclude them. An explicit simulator AI option sends the event through BullMQ while retaining that source marker.

The worker currently uses the community `tiktok-live-connector` adapter in explicit `tiktok` mode. TikTok event availability and connection behavior depend on upstream access. The worker uses a Redis lock per channel, publishes throttled room viewer counts, and reconnects with backoff when disconnected or silent for two minutes. TikTok's member event had a top-level `userId` of `0` in the tested LIVE; normalization now uses the nested `user.id`. No `viewer.leave` is fabricated. The overlay infers departures from a lower room count by moving the least recently active characters out, and also expires inactive characters after the configured TTL.

The scene uses the supplied temple background and standing, kneeling and bowing frames from `nhanvat01.png`. PixiJS moves each new viewer from the entrance to a free place, then transitions through kneel and bow before holding the kneeling pose. A separate React `BuddhistUserBadge` follows each character; its decorative PNG, circular avatar and Unicode nickname are independent layers. TikTok avatar URLs are normalized and persisted with the viewer. If all places are occupied, an old inactive character exits and a new join waits for the place. Resting characters bow at random intervals unless reduced motion is selected. A seat is allocated once per viewer and released on leave or inactivity. On a new overlay load, only current viewers are restored; historical gift events are not replayed. New gifts focus the camera on the giver while other characters blur and dim. The overlay serializes speech playback, falls back to browser Vietnamese speech synthesis when Google TTS is unavailable, and lowers the hidden YouTube IFrame Player volume during speech. Voice ID, speaking rate, pitch and volume are stored per LIVE; the Google TTS worker reads those values for synthesis. Failed TTS synthesis does not suppress the AI text event.

The Pixi canvas and HTML layers share a centered 9:16 frame, so badges, flying prayers and gifts keep their positions when the browser viewport differs from phone aspect ratio. The worker passes TikTok's HTTPS `giftDetails.giftImage.url` through the event payload. Fresh completed gifts create a bounded falling-image animation on a random upper side of the temple; total gift coins control its size. The API snapshot includes cumulative coins for active viewers. The overlay uses those totals to restore a donor's golden halo and longer badge fade after reload, without replaying historical gift animations.

## Security and operations

Passwords use Argon2id. Sessions are HTTP-only, SameSite=Lax cookies, secure on production. Login is rate limited in Redis and verifies Cloudflare Turnstile through Siteverify when configured. API mutations reject disallowed browser origins. Database and Redis have no public ports in Compose. The admin bootstrap reads environment variables and never logs credentials.

The initial release has one API instance. Multi-instance Socket.IO needs a Redis adapter; the current pub/sub feed reaches each instance, but room state is local. Docker Compose is intentionally a single-host deployment.
