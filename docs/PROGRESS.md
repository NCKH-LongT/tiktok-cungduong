# Progress and acceptance status

This repository is a working foundation and simulator vertical slice, **not a completed 26-point MVP**.

| Area | State | Evidence / gap |
|---|---|---|
| PostgreSQL, Prisma, bootstrap admin | Verified locally | Migration and admin bootstrap succeeded against Compose PostgreSQL on 2026-10-31 |
| Login, sessions, tenant checks | Verified locally | Password login, cookie session and cross-account read/write denial passed smoke test; password reset and full RBAC editor pending |
| Turnstile | Implemented when secret configured | Needs real site key and browser widget wiring |
| TikTok connector | Live events verified locally | On 2026-10-31, `thaobedim` connected through the Compose worker and produced real room, chat, join, like and gift rows; a real join also reached the dashboard Socket.IO client. Gift dedup wrote two real gift records from three gift events. Follow/share events remain unverified. Docker DNS required `TIKTOK_DNS=1.1.1.1` on this host. |
| Simulator → DB → Socket → overlay | Partial verification | HTTP and Socket.IO smoke passed login, LIVE creation, simulation, event delivery, snapshot, analytics isolation, cross-account denial and token revoke. Headless Chrome rendered the PixiJS scene and a character; motion and audio still need visual E2E check. |
| Gemini and Google TTS | Gemini verified; TTS partial | On 2026-10-31, Gemini answered a direct request and Compose AI smoke passed simulator → BullMQ → Gemini → Socket.IO. Per-LIVE voice ID, rate, pitch and volume are stored. Google TTS still needs verification because the configured credential path is unavailable locally; browser speech fallback depends on browser support. |
| Scene animation | Supplied background and character sprite integrated | Headless Chrome rendered the new scene and a simulated viewer holding the kneeling pose; walking and bow timing, OBS appearance and performance benchmark still need full visual verification. |
| Leaderboard | Real gift rows only | Simulator gifts excluded; retention controls pending |
| Music and mixer | Partial | YouTube IFrame Player, serialized speech playback and volume ducking implemented; real browser/OBS audio behavior and full mixer channels still need verification |
| Docker Compose and Jenkins | Compose verified locally | Application image built; all Compose services started; Nginx smoke passed on port 8080. Jenkins pipeline and HTTPS deployment still need target infrastructure verification. |
| Security hardening | Partial | Secret encryption, CSRF token, full RBAC, data retention, load tests pending |

The simulator is never counted as a real TikTok LIVE. Google TTS output remains unverified without a usable service-account file.

## `req.md` acceptance criteria

| # | Status | Remaining evidence or work |
|---|---|---|
| 1 | Partial | Admin login, account creation, lock and delete work; full role and quota editor pending. |
| 2 | Verified | USER password login passed integration smoke. |
| 3 | Partial | Backend Siteverify and browser widget implemented; no Turnstile credentials available for live verification. |
| 4 | Verified | Prisma migration and API writes passed against PostgreSQL. |
| 5 | Implemented | Multiple channel records supported; concurrent LIVE connection test pending. |
| 6 | Implemented | AI, audio and scene configs are per channel; broader configuration panel pending. |
| 7 | Verified | Authorized Socket.IO delivery passed smoke. |
| 8 | Partial | `thaobedim` connected and real join, chat, like and gift events were stored; follow/share still need live event verification. |
| 9 | Partial | Join, leave, comment, like, follow, share and gift simulation work; failure and network scenarios pending. |
| 10 | Verified configuration | AI personality and per-LIVE voice settings persist and appear in overlay snapshot; Google voice output remains unverified. |
| 11 | Partial | Gemini comment answer passed smoke; cooldown boundary tests pending. |
| 12 | Verified in simulator | Gift thank-you text reached Socket.IO in AI smoke; live gift input remains unverified. |
| 13 | Partial | Overlay rendered in headless Chrome; OBS Browser Source audio test pending. |
| 14 | Verified | Join created a sprite character on the supplied temple image in the Chrome overlay screenshot. |
| 15 | Implemented | Supplied sprite walks to an allocated place in Pixi ticker; animation capture test pending. |
| 16 | Partial verification | Supplied kneel and bow frames transition to a held kneeling pose; Chrome captured the final kneeling pose, bow timing capture pending. |
| 17 | Implemented | Comment label uses a 3 second timer; timer test pending. |
| 18 | Implemented | Gift camera zoom and character highlight exist; cinematic capture test pending. |
| 19 | Implemented | Camera returns to overview after queue timeout; capture test pending. |
| 20 | Implemented | Leave and inactivity TTL release seats; behavior test pending. |
| 21 | Partial | Top 5 uses deduplicated real gift rows; live gift feed verification pending. |
| 22 | Partial | Music volume ducking implemented; browser audio test pending. |
| 23 | Partial | Wooden fish sound is implemented and configurable; audio test pending. |
| 24 | Verified | Cross-account read and write attempts were denied in smoke. |
| 25 | Verified | All Compose services started and Nginx smoke passed. |
| 26 | Partial | Unit and integration tests plus operations docs exist; load and OBS tests pending. |
