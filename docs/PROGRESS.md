# Progress and acceptance status

## Farm Công Đức and AI batching, 2026-11-02 (`main`)

Combo quà TikTok giờ được nhận diện theo phiên LIVE; nếu TikTok thiếu group ID, worker theo dõi chuỗi quà ngắn của từng người và loại quà. Số CĐ lấy theo tổng xu của combo, không cộng lặp các mốc x20→x30. Bảng CĐ, thống kê quà và hào quang chỉ lấy dữ liệu từ lần kết nối thành công gần nhất, nên LIVE mới bắt đầu từ 0; lịch sử quà vẫn lưu trong database. Quà rơi có vị trí, độ lệch, góc xoay và thời gian ngẫu nhiên. Khi cảnh đầy, người tặng quà chưa có nhân vật được cấp chỗ ngay; camera chuyển tới người đó và bảng tên luôn sáng, nằm trên bảng CĐ khi zoom.

AI gom bình luận thường của cùng một người trong cửa sổ 5 giây thành một câu trả lời dùng ngữ cảnh các bình luận gần đây. Quà cùng loại từ nhiều người được gom trong 6 giây thành một lời cảm ơn nhắc tên, dùng mẫu tiếng Việt nên không tốn Gemini token. Lời niệm Phật/cầu nguyện vẫn gom 8 giây. Bài Docker smoke riêng đã kiểm tra reset CĐ, combo x20→x30 rồi combo x20 khác cho tổng 50 CĐ, tín hiệu cuối combo lặp không phát lại animation, hai bình luận thành một AI reply và hai người tặng cùng quà thành một lời cảm ơn. Chrome headless với 40 nhân vật đã xác nhận người tặng thứ 41 được lấy nét, bảng tên có opacity 1/z-index 8, và các quà rơi ở vị trí khác nhau. Unit test, typecheck và build web đạt; vẫn cần đối chiếu trên LIVE TikTok thật hoặc OBS sau deploy.

## Farm Công Đức feature audit, 2026-11-02 (`main`)

Bảng Công Đức đã được sửa trên `main`: trước đây API xếp theo xu nhưng overlay hiện số quà, khiến thứ hạng không khớp số trên bảng. API và overlay nay dùng cùng tổng CĐ; quà không rõ xu tính một điểm mỗi món, bằng điểm thì xét số quà và TikTok ID. Overlay bỏ lần tải bảng lặp và bỏ qua phản hồi cũ đến muộn. Bài smoke trên Docker/PostgreSQL riêng đã kiểm tra thứ tự điểm `100, 13, 5, 5` qua cả Analytics và overlay snapshot. Chưa kiểm tra trực tiếp trên phiên LIVE TikTok thật sau sửa.

Đối chiếu mã nguồn với tài liệu trên commit `6f70729`. Hệ thống hiện có: đăng nhập/Turnstile, payOS day pass, quản lý nhiều LIVE, kết nối TikTok thủ công, thống kê LIVE, AI tiếng Việt với Gemini và lịch sử từng viewer, Google/local TTS, overlay Farm 9:16, quản trị user/doanh thu/lượt AI, Docker Compose và Jenkins `main`. Bảng tính năng và cách sử dụng nằm trong [README](../README.md#tính-năng-hiện-có-trên-main).

Các commit mới sau lần cập nhật tài liệu trước bổ sung phân loại bình luận niệm Phật/cầu nguyện có dấu và không dấu; gom quà TikTok thật trong cửa sổ 10 giây, bình luận cùng nhóm trong cửa sổ 8 giây thành một lời đọc. Lời gom dùng mẫu cố định, không gọi Gemini; vẫn dùng TTS theo cấu hình. Combo quà lưu số lượng tích lũy lớn nhất, bảng công đức xếp theo tổng xu ước tính và cập nhật khi combo tăng. API/worker chặn phát lời gom trùng khi BullMQ retry. Simulator vẫn xử lý từng sự kiện để thử nghiệm. Khi TikTok lỗi hoặc im lặng quá hai phút, worker đánh dấu `unavailable` và chờ người vận hành kết nối lại; không tự reconnect.

Kiểm tra tại workspace: `npm test` đạt 30/30 test, `npm run build -w @cd/web` và `npm run typecheck` đều đạt. Đây là unit/build check; chưa kiểm tra chuỗi quà/bình luận đông người với TikTok thật, âm thanh trên OBS hoặc Jenkins production. Battle Arena ở nhánh `feature/battle-arena`, không có trong `main`.

This repository is a working foundation and simulator vertical slice, **not a completed 26-point MVP**.

| Area | State | Evidence / gap |
|---|---|---|
| PostgreSQL, Prisma, bootstrap admin | Verified locally | Migration and admin bootstrap succeeded against Compose PostgreSQL on 2026-10-31 |
| Login, sessions, tenant checks | Verified locally | Password login, cookie session and cross-account read/write denial passed smoke test; password reset and full RBAC editor pending |
| Turnstile | Implemented when secret configured | Browser widget and backend Siteverify exist; production hostname/key verification pending |
| TikTok connector | Live events verified locally | On 2026-10-31, `thaobedim` connected through the Compose worker and produced real room, chat, join, like and gift rows; a real join also reached the dashboard Socket.IO client. On 2026-11-01, direct SDK inspection found `member.userId=0` but a distinct `member.user.id`; normalization now uses the nested ID. The channel went offline during this update, so the corrected real join stream still needs verification when it resumes. Docker DNS required `TIKTOK_DNS=1.1.1.1` on this host. |
| Simulator → DB → Socket → overlay | Partial verification | HTTP and Socket.IO smoke passed login, LIVE creation, join/leave presence, event delivery, snapshot, analytics isolation, cross-account denial and token revoke. Headless Chrome rendered two characters and their removal after simulated room count dropped to zero; bow timing and audio still need visual E2E check. |
| Gemini and Vietnamese TTS | API audio verified; OBS playback pending | Compose AI smoke passed simulator → BullMQ → Gemini → Google TTS MP3 → Socket.IO using a locally mounted service account. Google/local TTS priority and fallback, per-LIVE voice ID, rate, pitch and volume are implemented. Browser/OBS audible playback still needs operator verification. The credential is excluded from Git and the image. |
| Scene animation | Updated background, character sprite and Buddhist badges integrated | Headless Chrome rendered the updated temple background, a kneeling viewer and a layered name badge. Random ambient bows are implemented; OBS appearance and performance benchmark still need full verification. |
| Leaderboard | Real TikTok gift rows only | Combo stores the largest cumulative count and ranks by estimated coins; simulator gifts excluded; real LIVE combo and retention controls pending |
| Music and mixer | Partial | YouTube IFrame Player, serialized speech playback and volume ducking implemented; real browser/OBS audio behavior and full mixer channels still need verification |
| Docker Compose and Jenkins | Compose and CI helper scripts verified locally | Application image built; all Compose services healthy; Nginx smoke passed on port 8090 after the host port change. Jenkins Pipeline-from-SCM checks out `main`, verifies `origin/main`, then automatically deploys successful builds using secret-file credential `tiktok-cungduong`. It bootstraps checksum-verified Node 22 when the agent has no npm and checks Docker prerequisites before building an image. It archives one Docker cache file, retains three numbered CI images and 20 Jenkins build records. A real Buildx probe confirmed local cache export/import and a cache hit; shell helper tests covered retention, logging and no-build deployment. The target Jenkins server and HTTPS deployment still need infrastructure verification. |
| payOS day pass | Implemented; real paid transfer pending | Non-admin accounts require a 50,000₫ payment for 24 hours of LIVE access. The server verifies payOS webhooks, stores orders, settles each order once and reconciles pending links with payOS; admin accounts remain free. Local Compose integration created and cancelled real unpaid payOS links, rejected an invalid signature and a signed underpayment, confirmed one 24-hour grant despite duplicate webhook delivery, and produced one order from simultaneous checkout requests through Nginx. A simulator join, leave and rejoin produced one AI welcome marker. Configure the production HTTPS webhook and update Jenkins Secret file with payOS keys before taking real payments. |
| Security hardening | Partial | Per-LIVE Gemini key encryption and origin checks exist; CSRF token, full RBAC, data retention and load tests pending |

The simulator is never counted as a real TikTok LIVE. Google TTS produced MP3 in the local Compose smoke test; audible output in OBS remains unverified.

## Manual admin AI usage reset, 2026-11-01

The admin account page lists each account's UTC-day AI usage and limit. An admin can manually reset the target account's current-day AI count and the welcome/repeat-comment daily subcounts; all of that account's LIVE channels share the refreshed allowance. Google TTS usage, per-minute throttles and AI history remain intact. The API requires an admin session, restricts resetting a super-admin account to super-admins, and records an audit entry containing the previous count. A local Docker integration test seeded all three AI counters for a temporary user, confirmed a normal user received HTTP 403, reset as admin, verified all AI counters and the displayed count returned to zero, checked the TTS counter remained unchanged, and found the audit entry.

## Phone overlay and donor effects, 2026-11-01

The overlay now centers a fixed 9:16 scene in any browser viewport; OBS Browser Source should use 1080 × 1920. The TikTok worker forwards HTTPS gift images from TikTok events. New completed gifts fall on a random upper side of the temple with image size based on total coins; missing images show the gift name. The dashboard Simulator accepts a gift image URL for visual testing. Active donors regain their cumulative golden halo and slower name-badge fade from the API snapshot after F5. Old gifts are not replayed. Local voices appear before Google voices in Voice & Audio. Unit tests, TypeScript checks, production and Docker builds passed. A local Docker smoke verified Socket.IO gift images and the 100-coin snapshot total; headless Chrome measured a 405 × 720 scene in a 1280 × 720 window and a 540 × 960 scene in a 540 × 960 window, and observed a falling gift after a new event. Real TikTok gift images and OBS appearance still need a live operator check.

## Badge, gifts, music and AI update, 2026-11-01

The supplied `bang-ten-phat-tu.png` is served unchanged as the badge decoration. `BuddhistUserBadge` positions avatar and Unicode nickname in independent HTML layers; a mask exposes the avatar while keeping the lotus and gold frame above it. Long names use at most two lines with ellipsis. The badge follows each Pixi character and scales with camera focus. The updated temple background is included. A new gift zooms deeper into its giver and blurs/dims other characters. Refresh restores current viewers but does not replay old gift zooms. The leaderboard is titled **Bảng Công Đức** and counts `+N công đức`. The YouTube video player is offscreen. AI history is visible in the dashboard, and the overlay keeps Vietnamese replies visible for at least six seconds; Google TTS failure falls back to browser speech. Local service-account credentials are mounted through ignored `secrets/` and excluded from the Docker image. Repeated AI smoke runs had consumed the admin's daily AI allowance and blocked real replies; the smoke now creates a temporary user so its quota is isolated. The admin counter was restored to the number of completed real TikTok interactions.

## Dashboard and presence update, 2026-11-01

The dashboard now reports TikTok room viewers and total viewers, unique join IDs, comments, gifts, like events, heart counts and shares, plus recent comments and gifts. It also shows the last successful connection and last TikTok event time. Successful worker sessions with the same TikTok room ID are aggregated; failed connection attempts do not reset the most recent successful broadcast. A database-backed stats smoke test covers these totals and reconnection. TikTok's chat text comes from `content`, which the old worker did not store; historical empty comment text cannot be reconstructed from the existing rows. `thaobedim` was offline during final validation, so current room viewers correctly show zero and a reopened overlay clears stale TikTok characters. The SDK has no reliable per-viewer leave event, so character departure is inferred from room-count decreases and inactivity rather than identified exactly.

## `update.md` implementation, 2026-11-01

The overlay uses the temple background and a compact **Bảng Công Đức**; the redundant text plaque was later removed because the background already has the title. The board uses TikTok avatars and `+N CĐ`; only real TikTok gifts appear there. Name badges are 80% of the former size, switch to the supplied VIP PNG after a viewer's recorded gifts exceed 100 xu, fade over 10 seconds, and brighten whenever the character bows. A simulator field accepts gift value in xu so the VIP presentation can be tried without altering the real gift board. TikTok gift parsing now distinguishes ordinary gifts from unfinished gift streaks, fixing a path that had suppressed ordinary thank-you replies. AI accepts normal Vietnamese comments, uses a separate limited greeting budget, prioritizes gifts then first comments then repeated comments then greetings, and asks Gemini to vary thank-you text by gift value. Saved audio and scene settings are emitted to open overlays over Socket.IO; a changed YouTube URL remounts the hidden player. Local unit/type checks and the Docker AI smoke passed for a normal comment, a 101 xu gift with VIP snapshot, Google TTS MP3, and a live audio configuration event. Audible OBS playback and a real gift after the next broadcast remain to be verified.

## Connection, prayer comments and speech update, 2026-11-01

TikTok now connects only after the dashboard control socket is open and the operator presses **Kết nối TikTok**. The dashboard shows one action button and a clear Vietnamese status. **Dừng TikTok** publishes an immediate disconnect command to the worker, clears active viewers, pauses overlay speech/music, and removes the characters. Closing or leaving the dashboard disconnects its control socket; the API stops the LIVE after a two-second reload grace period if no controller remains. The worker no longer automatically reconnects after a failed session. API restart resets any stale connection status to stopped. A Docker smoke test verified manual connect, immediate stop, Socket.IO status broadcasts and automatic stop on dashboard exit with the TikTok worker paused. A headless Chrome check verified the single button, status feedback, and default-muted preview toggle.

Comments beginning with `Cầu:` animate right to left with the viewer name and avatar. A headless Chrome test verified the strip, badge, background, and removal of the duplicate title and connected label. The leaderboard font is smaller; every ten seconds, two to four kneeling characters bow when available. The overlay frame rate is capped at 30 FPS. The dashboard preview starts muted and has an audio toggle, while OBS overlay audio remains independent.

AI responses no longer have the former 900-character cut. Gemini receives the last eight comments and their AI replies from the same viewer in the LIVE channel. Its output addresses the viewer by name, and Google TTS MP3 playback has a two-minute completion timeout so longer speech is not stopped after 20 seconds. The Docker AI smoke verified a contextual follow-up, named reply, conversation API, gift response and generated MP3. Audible background-tab and OBS playback still need direct operator verification in the target browser/OBS installation.

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
| 10 | Verified configuration and API audio | AI personality and per-LIVE voice settings persist; Google TTS returned MP3 in Compose. OBS playback remains unverified. |
| 11 | Partial | Gemini comment answer passed smoke; cooldown boundary tests pending. |
| 12 | Verified in simulator | Gift thank-you text reached Socket.IO in AI smoke; live gift input remains unverified. |
| 13 | Partial | Overlay rendered in headless Chrome; OBS Browser Source audio test pending. |
| 14 | Verified | Join created a sprite character on the supplied temple image in the Chrome overlay screenshot. |
| 15 | Implemented | Supplied sprite walks to an allocated place in Pixi ticker; animation capture test pending. |
| 16 | Partial verification | Supplied kneel and bow frames transition to a held kneeling pose; Chrome captured the final kneeling pose, bow timing capture pending. |
| 17 | Implemented | Comment label uses a 3 second timer; timer test pending. |
| 18 | Implemented | Gift camera zoom, surrounding blur/dim and character highlight exist; cinematic capture test pending. |
| 19 | Implemented | Camera returns to overview after queue timeout; capture test pending. |
| 20 | Implemented | Leave and inactivity TTL release seats; behavior test pending. |
| 21 | Partial | Top 5 uses deduplicated real gift rows; live gift feed verification pending. |
| 22 | Partial | Music volume ducking implemented; browser audio test pending. |
| 23 | Partial | Wooden fish sound is implemented and configurable; audio test pending. |
| 24 | Verified | Cross-account read and write attempts were denied in smoke. |
| 25 | Verified | All Compose services started and Nginx smoke passed. |
| 26 | Partial | Unit and integration tests plus operations docs exist; load and OBS tests pending. |
