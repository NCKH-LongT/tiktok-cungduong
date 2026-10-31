# Progress and acceptance status

This repository is a working foundation and simulator vertical slice, **not a completed 26-point MVP**.

| Area | State | Evidence / gap |
|---|---|---|
| PostgreSQL, Prisma, bootstrap admin | Verified locally | Migration and admin bootstrap succeeded against Compose PostgreSQL on 2026-10-31 |
| Login, sessions, tenant checks | Verified locally | Password login, cookie session and cross-account read/write denial passed smoke test; password reset and full RBAC editor pending |
| Turnstile | Implemented when secret configured | Needs real site key and browser widget wiring |
| TikTok connector | Live events verified locally | On 2026-10-31, `thaobedim` connected through the Compose worker and produced real room, chat, join, like and gift rows; a real join also reached the dashboard Socket.IO client. On 2026-11-01, direct SDK inspection found `member.userId=0` but a distinct `member.user.id`; normalization now uses the nested ID. The channel went offline during this update, so the corrected real join stream still needs verification when it resumes. Docker DNS required `TIKTOK_DNS=1.1.1.1` on this host. |
| Simulator → DB → Socket → overlay | Partial verification | HTTP and Socket.IO smoke passed login, LIVE creation, join/leave presence, event delivery, snapshot, analytics isolation, cross-account denial and token revoke. Headless Chrome rendered two characters and their removal after simulated room count dropped to zero; bow timing and audio still need visual E2E check. |
| Gemini and Google TTS | Gemini verified; TTS partial | On 2026-10-31, Gemini answered a direct request and Compose AI smoke passed simulator → BullMQ → Gemini → Socket.IO. Per-LIVE voice ID, rate, pitch and volume are stored. Google TTS still needs verification because the configured credential path is unavailable locally; browser speech fallback depends on browser support. |
| Scene animation | Supplied background and character sprite integrated | Headless Chrome rendered two viewers kneeling and their removal when room count dropped. Random ambient bows are implemented; timing, OBS appearance and performance benchmark still need full visual verification. |
| Leaderboard | Real gift rows only | Simulator gifts excluded; retention controls pending |
| Music and mixer | Partial | YouTube IFrame Player, serialized speech playback and volume ducking implemented; real browser/OBS audio behavior and full mixer channels still need verification |
| Docker Compose and Jenkins | Compose verified locally | Application image built; all Compose services started; Nginx smoke passed on port 8080. Jenkins pipeline and HTTPS deployment still need target infrastructure verification. |
| Security hardening | Partial | Secret encryption, CSRF token, full RBAC, data retention, load tests pending |

The simulator is never counted as a real TikTok LIVE. Google TTS output remains unverified without a usable service-account file.

## Dashboard and presence update, 2026-11-01

The dashboard now reports TikTok room viewers and total viewers, unique join IDs, comments, gifts, like events, heart counts and shares, plus recent comments and gifts. It also shows the last successful connection and last TikTok event time. Successful worker sessions with the same TikTok room ID are aggregated; failed connection attempts do not reset the most recent successful broadcast. A database-backed stats smoke test covers these totals and reconnection. TikTok's chat text comes from `content`, which the old worker did not store; historical empty comment text cannot be reconstructed from the existing rows. `thaobedim` was offline during final validation, so current room viewers correctly show zero and a reopened overlay clears stale TikTok characters. The SDK has no reliable per-viewer leave event, so character departure is inferred from room-count decreases and inactivity rather than identified exactly.

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
