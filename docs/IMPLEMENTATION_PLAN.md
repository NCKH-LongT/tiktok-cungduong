# Implementation plan

1. Foundation: schema, migrations, admin bootstrap, sessions, tenant checks, Compose and Jenkins.
2. Event path: TikTok adapter, Redis pub/sub, deduplication, event persistence, Socket.IO and simulator.
3. AI and sound: Gemini comment answers, gift/greeting text, Google TTS, speech queue, overlay playback.
4. Scene: PixiJS temple, seat assignment, walk/kneel/bow animation, comment bubbles, gift camera, leaderboard.
5. Hardening: complete RBAC, quotas, privacy retention, load testing, HTTPS deployment and production observability.

Each phase is only accepted after build and an integration test. See `PROGRESS.md` for the exact current state.
