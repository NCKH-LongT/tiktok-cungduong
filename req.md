# MASTER IMPLEMENTATION PROMPT — TIKTOK CÚNG DƯỜNG AI LIVE

## 1. Vai trò và mục tiêu

Bạn là Senior Full-stack Architect, Backend Engineer, AI Engineer, Game Developer và DevOps Engineer.

Nhiệm vụ là xây dựng ứng dụng **TikTok Cúng Dường AI Live**, một nền tảng quản lý nhiều TikTok LIVE với AI tương tác tự động, giọng đọc tiếng Việt và không gian chánh điện ảo có nhân vật hoạt hình.

Repository:

`https://github.com/NCKH-LongT/tiktok-cungduong.git`

Mục tiêu cuối cùng là một ứng dụng hoạt động thực tế, không phải chỉ có giao diện mẫu.

Yêu cầu làm việc:

- Kiểm tra repository, nhánh hiện tại, lịch sử commit và cấu trúc mã nguồn.
- Nếu repository trống thì khởi tạo monorepo.
- Nếu đã có mã nguồn, giữ nguyên chức năng đang hoạt động và nâng cấp có kiểm soát.
- Xây dựng frontend, backend, worker, database, AI engine và live overlay.
- Tạo Docker Compose để chạy hệ thống.
- Viết migration database, seed tài khoản quản trị an toàn và dữ liệu thử nghiệm.
- Tạo unit test, integration test, E2E test.
- Cập nhật README và tài liệu kiến trúc.
- Commit theo từng giai đoạn với thông điệp rõ ràng.
- Không tự động force-push, xóa dữ liệu hoặc ghi đè mã nguồn không liên quan.
- Không đưa API key, mật khẩu, session TikTok hoặc thông tin nhạy cảm vào Git.

**Nguyên tắc bắt buộc:** Chỉ đánh dấu chức năng hoàn thành khi có implementation và kiểm thử phù hợp. Không thay thế chức năng thật bằng dữ liệu giả rồi tuyên bố đã hoàn thành.

---

## 2. Technology stack

Sử dụng kiến trúc monorepo:

- Frontend: Next.js + TypeScript + Tailwind CSS + shadcn/ui.
- Backend: NestJS + TypeScript.
- Database: PostgreSQL + Prisma ORM.
- Cache và message broker: Redis.
- Background jobs: BullMQ.
- Socket server: Socket.IO.
- TikTok connector: Python service hoặc Node.js adapter, tùy connector ổn định và khả năng bảo trì.
- AI: Google Gemini.
- Text-to-Speech: Google Cloud TTS hoặc provider có hỗ trợ tiếng Việt.
- Scene rendering: PixiJS hoặc Phaser 3.
- Animation: Spine hoặc sprite animation.
- CAPTCHA: Cloudflare Turnstile.
- Authentication: Secure HTTP-only cookie sessions hoặc access/refresh token rotation.
- Logging: Pino hoặc Winston.
- API documentation: OpenAPI/Swagger.
- Deployment: Docker Compose, Nginx, HTTPS.

Ưu tiên hệ thống dễ triển khai VPS Ubuntu, dễ mở rộng, có thể chạy nhiều LIVE đồng thời.

---

## 3. Repository structure

Thiết kế cấu trúc dự kiến:

```text
tiktok-cungduong/
├── apps/
│   ├── web/
│   ├── api/
│   ├── tiktok-worker/
│   ├── ai-worker/
│   └── overlay/
├── packages/
│   ├── database/
│   ├── shared-types/
│   ├── event-contracts/
│   ├── ui/
│   └── configuration/
├── assets/
│   ├── temple/
│   ├── characters/
│   ├── animations/
│   └── sounds/
├── infrastructure/
│   ├── docker/
│   └── nginx/
├── docs/
├── tests/
├── docker-compose.yml
├── .env.example
└── README.md
```

Nếu công nghệ lựa chọn có cấu trúc phù hợp hơn, được phép điều chỉnh nhưng phải giải thích trong tài liệu kiến trúc.

---

## 4. Multi-tenant authentication và phân quyền

Xây dựng hệ thống tài khoản sử dụng PostgreSQL.

### 4.1 Authentication

Các chức năng:

- Đăng nhập bằng username/email và password.
- Đăng xuất.
- Đổi mật khẩu.
- Quên mật khẩu và đặt lại mật khẩu qua email khi SMTP được cấu hình.
- Cloudflare Turnstile ở form đăng nhập, đăng ký và đặt lại mật khẩu theo chính sách chống abuse.
- Kiểm tra Turnstile token tại backend bằng Siteverify, không tin xác thực từ frontend.
- Mã hóa mật khẩu bằng Argon2id.
- Rate limiting.
- Chống brute force và credential stuffing.
- Quản lý phiên đăng nhập.
- Thu hồi phiên khi đổi mật khẩu, vô hiệu hóa tài khoản hoặc bị admin yêu cầu.
- Audit log.

### 4.2 Roles và permissions

Tối thiểu có bốn vai trò:

**SUPER_ADMIN**

- Quản trị toàn hệ thống.
- Quản lý admin.
- Quản lý users.
- Phân quyền.
- Theo dõi trạng thái hệ thống.
- Quản lý giới hạn LIVE và AI quota.

**ADMIN**

- Tạo, sửa, khóa và vô hiệu hóa tài khoản theo quyền được giao.
- Phân quyền trong phạm vi được cấp.
- Xem nhật ký hệ thống trong phạm vi quản trị.
- Không thể tự nâng quyền thành SUPER_ADMIN.

**USER**

- Quản lý các kênh LIVE thuộc tài khoản.
- Chỉnh cấu hình AI.
- Chỉnh nhân vật, âm thanh, background.
- Xem thống kê và lịch sử.
- Tạo overlay URL.

**VIEWER**

- Chỉ xem dashboard và dữ liệu được chủ tài khoản chia sẻ.
- Không thể thay đổi cấu hình.

Thiết kế permission theo RBAC với các mã như:

`users.read`, `users.create`, `users.update`, `users.delete`, `roles.manage`, `live.create`, `live.manage`, `overlay.manage`, `ai.configure`, `analytics.read`.

Backend phải kiểm tra authorization ở mọi endpoint và Socket.IO room.

Mọi dữ liệu người dùng phải gắn owner hoặc tenant phù hợp, ngăn truy cập chéo giữa các tài khoản.

---

## 5. User dashboard

Sau đăng nhập, hiển thị dashboard chuyên nghiệp.

Các module:

### 5.1 Tổng quan

Hiển thị:

- Tổng số LIVE đã đăng ký.
- Số LIVE đang kết nối.
- Số LIVE mất kết nối.
- Tổng lượt comment.
- Tổng lượt like.
- Tổng lượt share được connector ghi nhận.
- Tổng số sự kiện quà tặng.
- Tổng điểm quà tặng ước tính khi có dữ liệu hợp lệ.
- Số câu AI đã trả lời.
- Tình trạng AI/TTS.
- Tình trạng kết nối Socket.IO.

### 5.2 Quản lý TikTok LIVE

Người dùng có thể:

- Thêm một hoặc nhiều TikTok username/uniqueId.
- Đặt tên tùy chỉnh cho từng LIVE.
- Sửa và xóa LIVE.
- Start/stop monitoring.
- Bật hoặc tắt auto reconnect.
- Theo dõi connection status.
- Xem thời gian kết nối gần nhất.
- Kiểm tra thông tin kênh.
- Mở trang cấu hình riêng.
- Mở overlay preview.
- Sao chép OBS Browser Source URL.
- Xem log sự kiện.

Chỉ cho phép số lượng phiên LIVE đồng thời theo quota tài khoản.

Không tạo một TikTok network connection riêng cho mỗi tab đang xem cùng một LIVE. Phải dùng một worker kết nối rồi phân phối sự kiện đến các subscriber được phép.

---

## 6. TikTok LIVE connector

Xây dựng module tách biệt để có thể thay connector sau này.

Interface dự kiến:

```typescript
interface TikTokLiveAdapter {
  connect(uniqueId: string): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ConnectionStatus;
  onEvent(callback: (event: LiveEvent) => void): void;
}
```

Các loại sự kiện cần hỗ trợ khi connector cung cấp:

- `room.connected`
- `room.disconnected`
- `viewer.join`
- `viewer.leave`
- `chat.comment`
- `viewer.like`
- `viewer.share`
- `viewer.follow`
- `gift.received`
- `room.stats`

### 6.1 Chuẩn hóa event

Sử dụng một event schema chung:

```typescript
interface LiveEvent {
  eventId: string;
  source: "tiktok" | "simulator";
  liveId: string;
  sessionId: string;
  eventType: string;
  timestamp: string;
  user?: {
    id?: string;
    uniqueId?: string;
    nickname?: string;
    avatarUrl?: string;
  };
  payload: Record<string, unknown>;
}
```

Đối với gift event, bổ sung:

- Gift ID.
- Gift name.
- Gift quantity.
- Gift image nếu có.
- Estimated coin value nếu connector cung cấp.
- Combo/streak identifier.
- Trạng thái combo hoàn tất.

Đối với like event:

- Số lượt like ghi nhận.
- Delta like nếu được cung cấp.
- Trạng thái có thể cộng dồn.

### 6.2 Reliability

- Exponential backoff reconnect.
- Connection heartbeat.
- Event deduplication.
- Bounded queue.
- Backpressure.
- Graceful shutdown.
- Per-LIVE isolation.
- Connection health metrics.
- Idempotent gift processing.
- Chống đếm trùng sự kiện quà tặng do combo/streak hoặc reconnect.

Không tự giả định sự kiện `viewer.leave` luôn tồn tại. Nếu không có tín hiệu đáng tin cậy, sử dụng inactivity timeout cho nhân vật và ghi rõ đây là trạng thái suy luận.

Không tự bịa thêm sự kiện share hoặc follow nếu connector không cung cấp.

Không tìm cách vượt qua CAPTCHA, cơ chế chống bot hoặc giới hạn truy cập của TikTok. Nếu connector không hoạt động, chuyển trạng thái sang unavailable và cung cấp simulation mode.

---

## 7. Real-time Socket.IO gateway

Backend phải phân phối LIVE event qua Socket.IO theo từng LIVE session.

Các namespace/room logic:

```text
live:{liveId}
overlay:{liveId}
dashboard:{userId}
admin:system
```

### Socket security

- Dashboard socket phải xác thực.
- Kiểm tra quyền trước khi join room.
- Overlay sử dụng token ngắn hạn hoặc token truy cập riêng có thể thu hồi.
- Không đưa JWT quản trị vào OBS URL.
- Không phát thông tin riêng tư của tài khoản qua overlay công khai.
- Rate limit socket events.
- Revalidate authorization khi cần.

### Event pipeline

```text
TikTok Connector
    ↓
Event Validation
    ↓
Normalization
    ↓
Redis / Job Queue
    ↓
Business Rules
    ↓
Database Persistence
    ↓
Socket.IO Gateway
    ↓
Dashboard / Overlay
```

Các sự kiện quan trọng phải được lưu trước hoặc theo cơ chế bảo đảm khả năng khôi phục phù hợp.

Socket cần hỗ trợ reconnect, sequence number và snapshot đồng bộ trạng thái hiện tại.

---

## 8. AI interaction engine — Gemini

Thiết kế AI Engine độc lập với TikTok connector.

Người dùng có thể cấu hình Gemini API key riêng hoặc sử dụng key do hệ thống quản lý theo quota.

Mã hóa API key khi lưu, không gửi lại plaintext xuống frontend.

### 8.1 Các chế độ AI

**Greeting mode**

Khi người mới vào LIVE:

- Chào theo tên người dùng.
- Không phát lời chào trùng liên tục.
- Có cooldown.
- Có thể cấu hình chỉ chào một số người trong khoảng thời gian nhất định.

Ví dụ:

"Nam mô A Di Đà Phật. Chào mừng phật tử Minh An đến với chánh điện. Kính chúc phật tử một ngày an lạc."

**Comment answering mode**

Nhận comment từ TikTok.

Hệ thống phải:

1. Phân tích comment.
2. Phân loại câu hỏi, lời chào, spam, nội dung không phù hợp và comment thông thường.
3. Xác định comment có cần AI trả lời hay không.
4. Kiểm tra cooldown và quota.
5. Gửi comment hợp lệ vào Gemini.
6. Sinh câu trả lời theo personality đã cấu hình.
7. Đưa kết quả vào speech queue.
8. Phát giọng đọc trên overlay.

Không cần gọi Gemini cho mọi comment. Sử dụng rules hoặc classifier nhẹ để giảm chi phí.

**Gift thank-you mode**

Khi có người tặng quà:

- Lấy nickname.
- Lấy tên quà.
- Lấy số lượng quà.
- Kiểm tra chống trùng.
- Sinh câu cảm ơn và lời chúc phù hợp.
- Đưa vào hàng đợi ưu tiên.
- Kích hoạt camera focus trên nhân vật.
- Đọc nội dung sau khi animation sẵn sàng.

Ví dụ:

"Nam mô A Di Đà Phật. Xin tri ân phật tử Minh An đã gửi tặng một đóa hồng. Kính chúc phật tử và gia đình thân tâm thường an lạc."

**Follow/share mode**

Cho phép cấu hình lời cảm ơn khi có follow hoặc share được connector ghi nhận.

### 8.2 AI personality settings

Cấu hình theo từng LIVE:

- Tên nhân vật AI.
- Vai trò người dẫn.
- Ngôn ngữ.
- Phong cách giao tiếp.
- Mức độ trang trọng.
- Độ dài câu trả lời.
- Tốc độ trả lời.
- Chủ đề cho phép.
- Chủ đề không cho phép.
- System prompt tùy chỉnh có kiểm soát.
- Số câu trả lời tối đa mỗi phút.
- Cooldown theo người dùng.
- Priority rules.

Personality mẫu:

**Trang nghiêm:** nhẹ nhàng, từ tốn, mang tinh thần Phật giáo.

**Thân thiện:** gần gũi, dễ hiểu, lịch sự.

**Giải thích Phật pháp:** trả lời kiến thức Phật giáo có kiểm soát độ chính xác.

**Thiền và an lạc:** nội dung ngắn, tích cực, bình an.

AI không được tự nhận là một vị Phật, một vị tăng sĩ có thật hoặc đưa ra lời khẳng định có quyền năng tâm linh.

Không hứa hẹn rằng tặng quà sẽ đổi lấy phước báu, công đức, sự chữa lành hoặc kết quả tâm linh.

### 8.3 Safety

- Chống prompt injection từ comment TikTok.
- Comment là dữ liệu không đáng tin cậy.
- Loại bỏ hướng dẫn yêu cầu AI tiết lộ secret hoặc thay đổi system prompt.
- Kiểm soát nội dung thù ghét, quấy rối và spam.
- Không đưa lời khuyên y tế/tài chính nguy hiểm.
- Giới hạn số token và chi phí mỗi tài khoản.
- Có chế độ tắt AI khẩn cấp.
- Có logging thời gian phản hồi và lỗi.

---

## 9. Text-to-Speech engine

Thiết kế speech engine hỗ trợ nhiều provider.

Các cấu hình:

- Giọng nam/nữ.
- Giọng tiếng Việt.
- Voice ID.
- Tốc độ đọc.
- Pitch nếu provider hỗ trợ.
- Âm lượng.
- Khoảng nghỉ giữa câu.
- Ngắt câu.
- Giới hạn thời lượng lời đọc.
- Cache các câu chào phổ biến.

### Speech priority queue

Ưu tiên mặc định:

1. Sự kiện quan trọng do user kích hoạt thủ công.
2. Gift thank-you.
3. Câu trả lời AI.
4. Follow/share.
5. Greeting.

Cho phép cấu hình lại mức ưu tiên.

Không phát chồng hai giọng AI nếu chế độ single-voice đang bật.

Nếu có quá nhiều comment, phải gộp, bỏ qua hoặc giới hạn queue theo cấu hình.

Hỗ trợ hủy speech và clear queue từ dashboard.

Khi giọng AI bắt đầu phát, overlay phải giảm âm lượng nhạc nền. Khi giọng đọc kết thúc, tăng âm lượng trở lại mượt mà.

---

## 10. Music và sound effects

### 10.1 Background music

User được nhập link YouTube.

Yêu cầu:

- Kiểm tra URL.
- Nhúng YouTube bằng phương thức được phép.
- Chỉnh âm lượng.
- Play/pause.
- Playlist nếu hỗ trợ.
- Loop theo khả năng player.
- Auto-ducking khi AI phát âm thanh.
- Lưu cấu hình theo LIVE.

Không sử dụng downloader để trích xuất nhạc trái phép từ YouTube.

Do các giới hạn autoplay, browser và YouTube embedding, cần hỗ trợ thêm nguồn audio hợp lệ như file nhạc được phép sử dụng hoặc audio do user upload có quyền.

### 10.2 Wooden fish sound — âm thanh gõ mõ

Hỗ trợ cấu hình tiếng mõ:

- Theo lượt like.
- Theo comment hợp lệ.
- Theo sự kiện được user lựa chọn.
- Theo phím bấm trong giao diện điều khiển.
- Bật/tắt độc lập.
- Điều chỉnh âm lượng.
- Cooldown.
- Thay file âm thanh.
- Số lần gõ tối đa mỗi giây.
- Gộp nhiều lượt like để tránh phát âm thanh quá dày.

Âm thanh mõ cần có âm lượng mặc định vừa phải và không gây khó chịu.

### 10.3 Audio mixer

Các kênh âm thanh độc lập:

- `music`
- `tts`
- `woodenFish`
- `ambient`
- `notification`

Mỗi kênh có volume 0–100%, mute và master volume.

Overlay là nơi phát âm thanh chính để OBS có thể thu audio. Dashboard preview không được tự động phát hai nguồn âm thanh trùng nhau.

---

## 11. Chánh điện ảo — Live Temple Overlay

Đây là tính năng trực quan quan trọng nhất.

Xây dựng một giao diện chánh điện hoạt hình, đẹp, mượt, có chiều sâu và phù hợp để hiển thị trong OBS.

### 11.1 Background scene

Các thành phần:

- Gian chánh điện.
- Bàn thờ và tượng Phật được thể hiện trang nghiêm.
- Ánh sáng vàng ấm.
- Đèn hoặc nến trang trí.
- Hương khói nhẹ.
- Sàn chánh điện.
- Các dãy tọa cụ hoặc vị trí quỳ.
- Không gian đi lại giữa các hàng.
- Hiệu ứng ánh sáng dịu.
- Bảng tri ân ở góc màn hình.

Ưu tiên phong cách 2.5D, isometric hoặc 2D skeletal animation chất lượng cao.

Tránh bắt đầu bằng mô hình 3D nặng nếu không có đủ assets và ngân sách GPU.

Cần có asset manifest, sprite loader, animation controller và fallback asset.

### 11.2 Responsive overlay

Hỗ trợ:

- 1080 × 1920 — TikTok portrait.
- 1920 × 1080 — landscape.
- 720 × 1280 — low-resource mode.
- Custom canvas size.

Các vùng UI quan trọng phải nằm trong safe area của TikTok.

### 11.3 Character system

Mỗi viewer được đại diện bởi một nhân vật hoạt hình.

Character states:

```text
SPAWNING
STANDING
WALKING
MOVING_TO_SEAT
KNEELING
BOWING
IDLE_KNEELING
STANDING_UP
LEAVING
DESPAWNING
```

Nhân vật phải có:

- ID ổn định.
- Nickname.
- Avatar.
- Character appearance.
- Current position.
- Target seat.
- Current animation state.
- Last activity time.
- Gift contribution.
- Temporary message.
- Highlight state.

Khi người xem vào LIVE:

1. Nhận `viewer.join`.
2. Kiểm tra người đó đã có nhân vật chưa.
3. Nếu chưa, chọn ngoại hình ngẫu nhiên từ asset pool.
4. Tạo nhân vật tại khu vực lối vào.
5. Tìm chỗ ngồi còn trống.
6. Di chuyển đến vị trí đã đặt.
7. Xoay hướng nhân vật nếu cần.
8. Chuyển từ đứng sang quỳ.
9. Thực hiện động tác lạy.
10. Chuyển sang idle kneeling.

Giữ nickname và avatar nhỏ trên đầu nhân vật.

Không tạo nhân vật trùng khi cùng một viewer gửi nhiều comment hoặc like.

### 11.4 Seat allocation

Tạo Seat Manager với cấu trúc:

```typescript
interface TempleSeat {
  id: string;
  row: number;
  column: number;
  x: number;
  y: number;
  occupiedBy?: string;
}
```

Yêu cầu:

- Phân bố ghế theo hàng.
- Không trùng vị trí.
- Khoảng cách hợp lý.
- Có đường đi.
- Xử lý nhiều viewer vào đồng thời.
- Giới hạn số nhân vật hiển thị theo hiệu năng.
- Có overflow queue.
- Khi nhân vật rời đi, giải phóng chỗ ngồi.

Nếu không nhận được leave event đáng tin cậy, áp dụng inactive TTL có cấu hình, thay vì tuyên bố viewer đã rời phòng.

### 11.5 Comment bubble

Khi một viewer comment:

- Tìm nhân vật tương ứng.
- Nếu chưa có, có thể tạo theo quy tắc cấu hình.
- Hiển thị nội dung comment thay nickname.
- Giới hạn độ dài comment trên màn hình.
- Escape nội dung để chống XSS.
- Sau 3 giây, khôi phục nickname.
- Nếu có comment mới trong lúc đang hiển thị, cập nhật timer.
- Giới hạn số bubble đồng thời để tránh rối màn hình.

### 11.6 Gift cinematic

Khi viewer tặng quà:

1. Nhận gift event đã được xác thực và chống trùng.
2. Tìm nhân vật viewer.
3. Tạm xếp cinematic event vào queue.
4. Smooth camera focus vào nhân vật.
5. Highlight nhân vật bằng ánh sáng vàng nhẹ.
6. Hiển thị tên người tặng, tên quà và số lượng.
7. Nhân vật thực hiện động tác chắp tay hoặc lạy.
8. Phát lời cảm ơn AI.
9. Giữ focus cho đến khi lời đọc hoàn tất hoặc hết giới hạn thời gian.
10. Fade hiệu ứng.
11. Zoom out trở lại toàn cảnh.
12. Xử lý gift event tiếp theo.

Nếu nhân vật chưa có trong scene, tạo nhân vật tạm hoặc một gift tribute card theo cấu hình.

Không dịch chuyển camera đột ngột.

Không cho nhiều cinematic event cùng điều khiển camera.

### 11.7 Camera controller

Các chế độ:

- Overview.
- Focus viewer.
- Gift cinematic.
- Smooth follow.
- Restore overview.

Có cấu hình:

- Camera zoom.
- Transition duration.
- Focus duration.
- Easing.
- Maximum zoom.
- Cinematic enabled/disabled.
- Reduced motion mode.

### 11.8 Animation requirements

Chuyển động phải mượt:

- Đi bộ.
- Đứng.
- Quỳ.
- Chắp tay.
- Lạy.
- Đứng dậy.
- Rời khỏi chánh điện.

Không thay thế động tác bằng hình đứng yên hoặc emoji.

Nếu chưa có asset hoàn chỉnh, xây dựng animation state machine với placeholder rõ ràng, có khả năng thay thế asset mà không thay đổi business logic.

---

## 12. Bảng tri ân Top 5

Hiển thị một bảng trong góc overlay.

Tên bảng mặc định:

**Bảng Tri Ân Phật Tử**

Hiển thị:

- Hạng.
- Nickname.
- Avatar.
- Tổng số quà.
- Tổng điểm quà tặng nếu có dữ liệu hợp lệ.

Các chế độ:

- Top 5 trong phiên LIVE.
- Top 5 hôm nay.
- Top 5 theo tuần.
- Top 5 toàn thời gian.

Tự cập nhật real-time.

Các số liệu phải lấy từ dữ liệu gift đã chuẩn hóa và deduplicate.

Điểm quà tặng không được mô tả là số tiền thực tế nếu không có dữ liệu đối soát.

Không hiển thị avatar/name khi người dùng đã được xử lý theo quy trình ẩn hoặc xóa dữ liệu phù hợp.

Không sử dụng bảng này để khẳng định mức độ công đức tâm linh phụ thuộc vào giá trị quà tặng.

---

## 13. Overlay URL và OBS integration

Mỗi LIVE được tạo một overlay riêng.

Ví dụ:

```text
https://domain.com/overlay/{liveId}?token={overlayToken}
```

Token phải đủ mạnh, có thể thu hồi và thay mới.

Cho phép:

- Copy OBS URL.
- Regenerate token.
- Revoke token.
- Preview overlay.
- Open in new tab.
- Refresh scene.
- Reconnect socket.
- Test event.
- Test AI voice.
- Test audio mixer.
- Hide/show individual widgets.

OBS browser source phải hoạt động mà không yêu cầu đăng nhập dashboard bằng cookie.

Trang overlay không được hiển thị menu admin hoặc dashboard.

Cần có trạng thái loading, disconnected và reconnecting.

Browser Source cần hỗ trợ sound playback, nhưng phải ghi rõ các hạn chế autoplay và cấu hình OBS cần thiết.

---

## 14. Live control panel

Trang chi tiết LIVE cần có các tab:

**Overview**

Thông tin LIVE, trạng thái, thống kê.

**AI Assistant**

Cấu hình Gemini, personality, greetings, question answering, thank-you messages, cooldown.

**Voice & Audio**

TTS, YouTube/music, âm thanh mõ, mixer và auto-ducking.

**Temple Scene**

Background, nhân vật, animation, seat layout, camera, effects.

**Events & Rules**

Mapping từng TikTok event sang action tương ứng.

**Overlay**

Preview, OBS URL, token và kích thước canvas.

**Analytics**

Biểu đồ theo thời gian, comment, like, gift và chi phí AI.

**Logs**

Event logs, connection logs, AI logs, lỗi hệ thống.

Có nút lưu cấu hình, khôi phục mặc định, kiểm thử từng chức năng.

---

## 15. Event-to-action rule engine

Không viết cứng toàn bộ logic TikTok vào component giao diện.

Thiết kế rule engine:

```typescript
interface LiveRule {
  id: string;
  liveId: string;
  triggerType: string;
  enabled: boolean;
  conditions: Record<string, unknown>;
  actions: LiveAction[];
  cooldownMs: number;
  priority: number;
}
```

Ví dụ rule:

```text
Trigger: viewer.join
Actions:
  - spawn.character
  - find.available.seat
  - character.walk
  - character.kneel
  - ai.greeting
```

```text
Trigger: chat.comment
Conditions:
  - not spam
  - user cooldown satisfied
Actions:
  - character.show.comment
  - ai.classify
  - ai.reply.when.relevant
```

```text
Trigger: gift.received
Actions:
  - leaderboard.update
  - camera.focus
  - character.highlight
  - ai.thank.you
  - camera.restore
```

```text
Trigger: viewer.like
Conditions:
  - wooden fish enabled
  - rate limit satisfied
Actions:
  - sound.play.wooden.fish
```

Tất cả rule cần có validation, timeout và kiểm soát lỗi.

---

## 16. PostgreSQL database design

Thiết kế Prisma schema và migration cho tối thiểu các thực thể:

| Model | Mục đích |
|---|---|
| User | Tài khoản |
| Role | Vai trò |
| Permission | Quyền |
| UserRole | Vai trò của tài khoản |
| RolePermission | Quyền của vai trò |
| AuthSession | Phiên đăng nhập |
| AuditLog | Nhật ký quản trị |
| LiveChannel | Kênh TikTok đã đăng ký |
| LiveSession | Phiên kết nối LIVE |
| LiveEvent | Sự kiện thu thập |
| Viewer | Người xem đã được ghi nhận |
| ViewerPresence | Trạng thái hiện diện ước lượng hoặc xác nhận |
| GiftEvent | Lịch sử quà |
| LiveRule | Quy tắc tương tác |
| AIConfiguration | Cấu hình AI |
| AIInteraction | Lịch sử sinh nội dung |
| SpeechJob | Hàng đợi TTS |
| AudioConfiguration | Cấu hình âm thanh |
| SceneConfiguration | Cấu hình chánh điện |
| CharacterState | Trạng thái nhân vật |
| OverlayToken | Quyền truy cập overlay |
| UsageMetric | Chỉ số sử dụng |
| UserQuota | Giới hạn tài khoản |

Yêu cầu:

- Primary key UUID.
- Foreign key đầy đủ.
- Index cho các truy vấn phổ biến.
- Unique constraint phù hợp.
- JSONB cho cấu hình linh hoạt.
- Timestamps.
- Soft delete ở các thực thể phù hợp.
- Không lưu dữ liệu viewer vô thời hạn theo mặc định.
- Có chính sách retention và xóa dữ liệu.
- Các thao tác liên quan gift/leaderboard phải bảo đảm idempotency và consistency.

Không lưu nguyên vẹn toàn bộ raw payload TikTok vô thời hạn nếu không có nhu cầu và cơ sở xử lý hợp lệ.

---

## 17. Admin management panel

Tạo `/admin` với đầy đủ chức năng:

- Dashboard quản trị.
- Danh sách tài khoản.
- Tạo tài khoản.
- Sửa tài khoản.
- Khóa/mở khóa.
- Vô hiệu hóa.
- Reset password qua quy trình an toàn.
- Phân quyền.
- Quản lý quota.
- Số lượng LIVE tối đa mỗi user.
- Giới hạn request Gemini.
- Giới hạn TTS.
- Kiểm tra LIVE đang kết nối.
- Xem worker health.
- Xem audit logs.
- Theo dõi lỗi hệ thống.

Không hardcode admin password.

Tạo bootstrap command đọc credential từ biến môi trường hoặc nhập bảo mật khi khởi tạo lần đầu.

---

## 18. User interface và trải nghiệm

Thiết kế giao diện hiện đại, dễ sử dụng, phù hợp cả desktop và mobile.

Phong cách:

- Dashboard SaaS chuyên nghiệp.
- Màu chủ đạo vàng đồng, nâu gỗ và màu trung tính.
- Chế độ sáng/tối.
- Sidebar có thể collapse.
- Các card cấu hình theo module.
- Form validation rõ ràng.
- Toast notification.
- Skeleton loading.
- Responsive layout.

Đối với trang cấu hình LIVE, sử dụng bố cục:

```text
┌──────────────────────────────────────────┐
│ Live Header / Connection Status         │
├───────────────┬──────────────────────────┤
│ Configuration │ Live Preview             │
│               │                          │
│ AI            │ Temple Scene             │
│ Voice         │                          │
│ Sound         │                          │
│ Characters    │                          │
│ Camera        │                          │
│ Rules         │                          │
├───────────────┴──────────────────────────┤
│ Event Timeline / Console                 │
└──────────────────────────────────────────┘
```

Cho phép thu gọn từng phần cấu hình.

Các cấu hình thay đổi cần có chế độ preview nhanh, và những thay đổi ảnh hưởng đến LIVE thật phải được lưu một cách có kiểm soát.

---

## 19. Live simulation mode

Bắt buộc xây dựng chế độ giả lập độc lập với TikTok.

Tạo Simulator Panel để kiểm thử:

- Viewer join.
- Viewer leave.
- Comment.
- Like.
- Share.
- Follow.
- Gift.
- Gift combo.
- Nhiều người vào cùng lúc.
- Viewer inactivity timeout.
- Network disconnection.
- AI error.
- TTS error.
- Socket reconnection.

Sử dụng simulator để kiểm thử toàn bộ luồng:

```text
Simulator
→ Backend
→ Event Pipeline
→ Socket
→ Temple Scene
→ Animation
→ AI
→ TTS
→ Camera
→ Audio
```

Sự kiện giả lập phải được đánh dấu rõ `source = simulator`, không được đưa vào số liệu LIVE thật hoặc bảng tri ân thật nếu chưa bật chế độ test riêng.

---

## 20. Performance và scalability

Mục tiêu thiết kế ban đầu:

- Hỗ trợ nhiều tài khoản độc lập.
- Một user quản lý nhiều LIVE.
- Không tạo duplicate TikTok connection.
- Overlay duy trì 30–60 FPS trên thiết bị phù hợp.
- Ưu tiên giảm tải khi số lượng nhân vật tăng.
- Tối đa số nhân vật hiển thị có cấu hình.
- Có object pooling cho nhân vật.
- Có sprite batching.
- Có giới hạn particle effects.
- Có giới hạn speech queue.
- Có throttling cho like events.
- Có health check cho workers.

Các ngưỡng thời gian xử lý phải được đo thực tế, không tự tuyên bố đạt latency thấp khi chưa benchmark.

Thử tải nhiều LIVE, nhiều viewer events và nhiều overlay subscriber bằng k6 hoặc công cụ phù hợp.

---

## 21. Security requirements

Các yêu cầu bắt buộc:

- Không commit secrets.
- Password Argon2id.
- Turnstile backend verification.
- Session/token rotation.
- Authorization ở backend.
- Secure Socket.IO handshake.
- Redis không public.
- PostgreSQL không public.
- CORS allowlist.
- Helmet/security headers.
- Input validation.
- SQL injection prevention.
- XSS prevention.
- Rate limiting.
- CSRF protection khi dùng cookie authentication.
- SSRF protection khi tải external resources.
- API key encryption.
- Audit logging.
- Secrets redaction.
- Docker containers chạy với quyền tối thiểu.
- Không thực thi code lấy từ comment hoặc cấu hình người dùng.

Cần xem nickname, avatar URL, comment và URL nhạc là dữ liệu không đáng tin cậy.

---

## 22. API requirements

Thiết kế REST API tối thiểu:

```text
POST   /auth/login
POST   /auth/logout
POST   /auth/refresh
GET    /auth/me

GET    /users
POST   /users
PATCH  /users/:id
DELETE /users/:id

GET    /roles
POST   /roles
PATCH  /roles/:id

GET    /lives
POST   /lives
GET    /lives/:id
PATCH  /lives/:id
DELETE /lives/:id

POST   /lives/:id/connect
POST   /lives/:id/disconnect
GET    /lives/:id/status

GET    /lives/:id/events
GET    /lives/:id/analytics

GET    /lives/:id/ai-config
PUT    /lives/:id/ai-config

GET    /lives/:id/audio-config
PUT    /lives/:id/audio-config

GET    /lives/:id/scene-config
PUT    /lives/:id/scene-config

GET    /lives/:id/rules
POST   /lives/:id/rules
PATCH  /lives/:id/rules/:ruleId
DELETE /lives/:id/rules/:ruleId

POST   /lives/:id/overlay-token/rotate
POST   /lives/:id/overlay-token/revoke

POST   /lives/:id/simulate
POST   /lives/:id/test-voice
POST   /lives/:id/test-gift

GET    /health
GET    /ready
```

Chuẩn hóa response, error codes, pagination và validation.

Tạo OpenAPI specification thực tế từ implementation.

---

## 23. Testing requirements

Xây dựng test cho:

### Authentication

- Login đúng/sai.
- Turnstile token không hợp lệ.
- Brute-force protection.
- Session expiry.
- Role escalation prevention.

### Multi-tenancy

- User A không đọc hoặc sửa LIVE của User B.
- Viewer không được quản trị.
- Overlay token không truy cập dữ liệu admin.

### TikTok events

- Normalize events.
- Deduplication.
- Gift combos.
- Reconnect.
- Out-of-order events.
- Unsupported viewer.leave.

### AI

- Prompt injection.
- Comment classification.
- Cooldown.
- Speech prioritization.
- Quota exhaustion.
- API failure.

### Temple scene

- Một viewer không tạo nhiều nhân vật.
- Seat không bị trùng.
- Comment bubble biến mất sau 3 giây.
- Gift focus hoạt động.
- Camera trở lại overview.
- Character despawn giải phóng ghế.
- Nhiều gift được xử lý theo queue.

### E2E

Kiểm thử từ đăng nhập đến tạo LIVE, cấu hình, mở overlay và nhận các sự kiện giả lập.

---

## 24. Deployment

Tạo Docker Compose cho:

- Web.
- API.
- TikTok worker.
- AI worker.
- Overlay nếu được deploy độc lập.
- PostgreSQL.
- Redis.
- Nginx.

Tạo `.env.example` gồm:

```env
DATABASE_URL=
REDIS_URL=

SESSION_SECRET=
ENCRYPTION_KEY=

TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

GEMINI_API_KEY=

GOOGLE_CLOUD_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=

PUBLIC_APP_URL=
PUBLIC_OVERLAY_URL=

TIKTOK_CONNECTOR_MODE=
LOG_LEVEL=
```

Không thêm giá trị bí mật thật vào file mẫu.

Yêu cầu:

- Database migrations.
- Health checks.
- Restart policies.
- Persistent volumes.
- Backup strategy.
- HTTPS.
- Structured logging.
- Graceful shutdown.
- README hướng dẫn Ubuntu VPS.

---

## 25. Phased implementation

Triển khai theo từng giai đoạn có thể chạy và kiểm thử.

### Phase 1 — Foundation

- Monorepo.
- PostgreSQL.
- Prisma.
- Redis.
- Authentication.
- Turnstile.
- RBAC.
- Admin.
- Docker Compose.

### Phase 2 — LIVE infrastructure

- TikTok connector interface.
- Worker.
- Event normalization.
- Socket.IO.
- Live management.
- Event logs.
- Simulator.

### Phase 3 — AI and sound

- Gemini integration.
- AI configuration.
- Comment classification.
- Greeting.
- Gift thank-you.
- TTS.
- Speech queue.
- Sound mixer.
- Wooden fish.
- Background audio.

### Phase 4 — Temple overlay

- Temple scene.
- Character pool.
- Seats.
- Walk/kneel/bow animation.
- Comment bubble.
- Camera.
- Gift cinematic.
- Top 5 leaderboard.
- OBS overlay.

### Phase 5 — Production hardening

- Security audit.
- Test coverage.
- Load testing.
- Error recovery.
- Performance optimization.
- Documentation.
- Deployment validation.

---

## 26. Acceptance criteria

Ứng dụng chỉ đạt trạng thái MVP hoàn chỉnh nếu:

1. Admin đăng nhập và quản lý tài khoản được.
2. Tài khoản user có thể đăng nhập.
3. Turnstile được backend xác thực.
4. Dữ liệu lưu thật vào PostgreSQL.
5. User thêm được nhiều TikTok LIVE ID.
6. Các LIVE có cấu hình độc lập.
7. Có kết nối real-time qua Socket.IO.
8. TikTok connector hỗ trợ event thực tế trong phạm vi có thể xác minh.
9. Simulator chạy được khi không có TikTok LIVE.
10. User cấu hình AI và giọng đọc.
11. AI trả lời comment phù hợp và có cooldown.
12. AI cảm ơn gift theo tên và tên quà.
13. Overlay chạy được trong trình duyệt và OBS.
14. Viewer join tạo nhân vật.
15. Nhân vật di chuyển tới chỗ trống.
16. Nhân vật quỳ và lạy.
17. Comment xuất hiện trên đầu nhân vật rồi biến mất sau 3 giây.
18. Gift kích hoạt highlight và camera zoom.
19. Camera quay về toàn cảnh sau cinematic.
20. Viewer leave hoặc inactivity timeout giải phóng nhân vật.
21. Top 5 cập nhật theo gift event hợp lệ.
22. Nhạc nền giảm âm lượng khi AI đọc.
23. Tiếng mõ hoạt động theo rule đã cấu hình.
24. User không thể truy cập LIVE hoặc dữ liệu của user khác.
25. Docker Compose có thể khởi chạy hệ thống.
26. Có test và tài liệu vận hành.

Nếu bất kỳ mục nào chưa hoàn thành, phải ghi rõ trạng thái và blocker.

---

## 27. Hướng dẫn tự động thực thi dành cho Codex

Bắt đầu bằng việc:

1. Kiểm tra Git repository và quyền truy cập.
2. Đọc toàn bộ mã nguồn hiện có.
3. Kiểm tra framework và dependencies.
4. Viết `docs/ARCHITECTURE.md`.
5. Viết `docs/IMPLEMENTATION_PLAN.md`.
6. Viết `docs/PROGRESS.md`.
7. Triển khai tuần tự từng phase.
8. Chạy migration và tests.
9. Sửa lỗi phát sinh.
10. Chạy kiểm tra end-to-end.
11. Cập nhật README.
12. Commit những thay đổi đã kiểm tra.
13. Đẩy nhánh triển khai lên remote khi được phép và báo cáo chính xác trạng thái.

Không tự ý ghi đè code hiện tại.

Không giả vờ có kết nối TikTok, AI hoặc TTS khi thiếu API key, quyền truy cập hay điều kiện vận hành.

Trong trường hợp thiếu credential bên ngoài:

- Hoàn thiện phần code và adapter.
- Bổ sung environment variables.
- Tạo simulation/mock mode tách biệt.
- Kiểm thử những gì có thể kiểm thử.
- Ghi blocker trong tài liệu.

**Yêu cầu quan trọng nhất: Xây dựng một ứng dụng có thể vận hành và phát triển lâu dài, không phải demo UI tĩnh. Ưu tiên tính đúng đắn, an toàn dữ liệu, trải nghiệm realtime và tính chân thực của animation.**