# CODEX EXTENSION PROMPT
# TU TIÊN BATTLE ARENA — ADMIN SPRITE STUDIO & ANIMATION PIPELINE

## 1. MỤC TIÊU

Nâng cấp ứng dụng Battle Arena trên repository:

https://github.com/NCKH-LongT/tiktok-cungduong.git

Nhánh phát triển:

`feature/battle-arena`

Nếu đã có nhánh này, tiếp tục phát triển trên nhánh đó. Không reset, không ghi đè công việc trước đó.

Nếu chưa có, tạo nhánh từ `origin/main`.

KHÔNG trực tiếp sửa hoặc push lên `main`.

KHÔNG kích hoạt Jenkins production deployment.

Yêu cầu xây dựng hệ thống quản trị tài nguyên game có tên:

**Admin Sprite Studio — Tu Tiên Battle Arena**

Admin có thể quản lý background đấu trường, upload nhân vật sprite, cắt sprite sheet AI thành từng frame, cấu hình animation, preview, điều chỉnh hitbox, pivot, thời gian từng frame và xuất bản nhân vật vào game.

Admin không cần chỉnh sửa source code thủ công khi muốn thay đổi ảnh nhân vật hoặc animation.

Hai ảnh sprite đầu tiên:

- `tutien1.png` — Đao Pháp Huyết Ảnh, hệ Hỏa, màu đỏ.
- `tutien2.png` — Kiếm Khí Băng Lam, hệ Băng, màu xanh dương nhạt.

Đây là tên các file nguồn. Trước tiên phải kiểm tra chúng có thực sự tồn tại trong workspace, repository hoặc assets được cung cấp hay không.

Nếu chưa có, triển khai công cụ upload và pipeline xử lý đầy đủ, ghi nhận trạng thái WAITING_FOR_ASSET. Không tự tuyên bố đã cắt hai ảnh thật hoặc thay chúng bằng ảnh khác mà không thông báo.

---

# 2. KIẾN TRÚC QUẢN TRỊ ASSET

Tạo module quản lý asset riêng cho Battle Arena.

Ưu tiên sử dụng PixiJS 8 đã có trong repository để render và preview animation. Không thêm Phaser 3 chỉ để dựng preview nếu PixiJS đáp ứng được yêu cầu.

Cần tách ba thành phần:

1. Sprite Processing Service — nhập và xử lý ảnh.
2. Sprite Studio UI — quản trị frame và animation.
3. Battle Renderer — tải animation đã được phê duyệt để sử dụng trong đấu trường.

Không để Battle Renderer tự cắt sprite sheet trong mỗi lần mở OBS.

Asset phải được xử lý trước, lưu thành phiên bản hoàn chỉnh, sau đó game chỉ tải atlas và metadata đã kiểm tra.

Các tài nguyên upload cần được lưu trên persistent storage, không nằm trong thư mục tạm của Jenkins hoặc container.

Có thể sử dụng local persistent volume cho MVP và thiết kế abstraction hỗ trợ S3-compatible object storage về sau.

---

# 3. GIAO DIỆN ADMIN

Thêm trang:

`/admin/battle-assets`

Các tab:

- Background Manager.
- Character Library.
- Sprite Importer.
- Frame Editor.
- Animation Editor.
- Sprite Simulator.
- Published Assets.

Chỉ tài khoản có quyền `battle.assets.manage` được chỉnh sửa hoặc publish.

User bình thường chỉ được xem và lựa chọn những asset mà admin đã publish, theo quyền được cấp.

Backend phải kiểm tra quyền, không chỉ ẩn nút ở frontend.

---

# 4. BACKGROUND MANAGER

Admin có thể:

- Upload background PNG, JPG hoặc WebP.
- Đặt tên đấu trường.
- Xem preview 9:16.
- Chọn background đang sử dụng.
- Chỉnh độ sáng, độ tương phản và độ mờ.
- Chỉnh background scale, position X/Y.
- Chọn fit mode: contain, cover hoặc custom.
- Cấu hình vị trí mặt sàn.
- Cấu hình khu vực nhân vật được di chuyển.
- Cấu hình biên trái và phải.
- Cấu hình khu vực UI không được che.
- Lưu bản nháp.
- Publish background.
- Rollback background về phiên bản trước.

Sử dụng canvas logic 1080 × 1920, scale responsive theo OBS hoặc trình duyệt.

Background phải hỗ trợ một hoặc nhiều ground zones để nhân vật đứng đúng mặt sàn, không bị lơ lửng hay chìm xuống nền.

Không làm ảnh hưởng background của Farm Công Đức.

---

# 5. SPRITE IMPORTER — XỬ LÝ ẢNH AI

Hai ảnh `tutien1.png` và `tutien2.png` không được mặc định là sprite atlas có frame đều nhau.

Không được giả định kích thước 64×64, 128×128 hoặc số hàng/cột cố định.

Xây dựng quy trình import:

### Step 1 — Upload

- Kiểm tra định dạng ảnh.
- Kiểm tra dung lượng.
- Kiểm tra kích thước.
- Giới hạn số pixel để tránh decompression bomb.
- Lưu bản gốc bất biến.
- Tạo checksum.
- Tạo thumbnail preview.

### Step 2 — Phát hiện frame ứng viên

Sử dụng image processing thích hợp như OpenCV hoặc Pillow trong một worker riêng.

Có thể kết hợp:

- Background color estimation.
- Color segmentation.
- Alpha mask.
- Connected component analysis.
- Contour detection.
- Row/column projection.
- Bounding box detection.
- Optional image segmentation model.

Nếu ảnh có các nhãn hàng animation, cần xác định vùng nhãn và loại bỏ trước khi tách nhân vật.

Không coi mỗi connected component là một frame, vì tóc, vũ khí, áo hoặc hiệu ứng có thể nằm rời nhau.

### Step 3 — Phân loại animation

Cho phép admin gắn từng frame vào:

- idle
- walk_left
- walk_right
- run_left
- run_right
- attack
- combo1
- combo2
- skill_q
- skill_w
- skill_e
- skill_r
- hit
- fall
- die

Nếu không nhận diện được animation, đặt trạng thái UNCLASSIFIED.

Không tự gán animation sai chỉ để hoàn thiện import.

### Step 4 — Loại nền và chỉnh mask

Cung cấp:

- Auto background removal.
- Color key threshold.
- Alpha mask preview.
- Manual erase.
- Manual restore.
- Feathering.
- Edge cleanup.

Phải xử lý được trường hợp hiệu ứng có màu gần giống nền.

### Step 5 — Bounding boxes

Cho phép chỉnh tay vùng frame:

- Move bounding box.
- Resize bounding box.
- Expand padding.
- Include weapon/effects.
- Split overlapping regions.
- Merge fragmented regions.

Nếu hai frame chồng nhau và không thể tách chắc chắn, đánh dấu NEEDS_REVIEW.

### Step 6 — Normalize

Chuẩn hóa frame vào cùng canvas size với:

- Transparent padding.
- Consistent character body scale.
- Consistent baseline.
- Stable foot pivot.
- Consistent anchor.

Không kéo giãn nhân vật làm sai tỷ lệ.

Đao, kiếm, tóc và hiệu ứng phải được giữ nguyên nếu thuộc frame.

### Step 7 — Output

Xuất:

- PNG RGBA frames.
- Optimized sprite atlas.
- Animation metadata JSON.
- Processing report.
- Validation warnings.

Chỉ dùng asset đã được validate và publish trong game production.

---

# 6. FRAME EDITOR

Tạo công cụ chỉnh frame trên web.

Bố cục:

```text
┌────────────────────────────────────────────────┐
│ Character: Đao Pháp Huyết Ảnh                 │
├──────────────┬─────────────────┬───────────────┤
│ Frame List   │ Frame Canvas    │ Properties    │
│              │                 │               │
│ Frame 01     │    Preview      │ X / Y         │
│ Frame 02     │    + Pivot      │ Width/Height  │
│ Frame 03     │    + Hitbox     │ Pivot         │
│ Frame 04     │                 │ Hurtbox       │
│              │                 │ Hitbox        │
├──────────────┴─────────────────┴───────────────┤
│ Animation Timeline                             │
└────────────────────────────────────────────────┘
```

Chức năng:

- Frame list.
- Drag and drop.
- Duplicate frame.
- Remove frame khỏi animation.
- Reorder.
- Manual crop.
- Transparent padding.
- Zoom 25–800%.
- Checkerboard background.
- Toggle bounding box.
- Toggle pivot.
- Toggle hitbox.
- Toggle hurtbox.
- Undo/redo.

Frame edit phải hỗ trợ draft và không ảnh hưởng phiên bản đã publish.

---

# 7. ANIMATION EDITOR

Mỗi nhân vật có một danh sách animation riêng.

Animation được tạo từ các frame ID.

Không dùng một FPS bắt buộc cho toàn bộ nhân vật.

Cấu trúc metadata ví dụ:

```json
{
  "characterId": "tutien1",
  "name": "Đao Pháp Huyết Ảnh",
  "element": "fire",
  "version": 1,
  "canvas": {
    "width": 512,
    "height": 512
  },
  "animations": {
    "idle": {
      "loop": true,
      "frames": [
        {"frameId": "idle_01", "durationMs": 160},
        {"frameId": "idle_02", "durationMs": 160}
      ]
    },
    "attack": {
      "loop": false,
      "frames": [
        {"frameId": "attack_01", "durationMs": 90},
        {
          "frameId": "attack_02",
          "durationMs": 75,
          "events": ["attack.visual-impact"]
        },
        {"frameId": "attack_03", "durationMs": 125}
      ]
    },
    "die": {
      "loop": false,
      "holdLastFrame": true,
      "frames": [
        {"frameId": "die_01", "durationMs": 120},
        {"frameId": "die_02", "durationMs": 200}
      ]
    }
  }
}
```

Đây là ví dụ schema, không phải dữ liệu được trích từ ảnh thật.

Mỗi animation có:

- Name.
- Ordered frames.
- Duration per frame.
- Loop.
- Playback speed.
- Direction.
- Root motion configuration.
- Optional visual event markers.
- Animation transitions.
- Hold last frame.
- Priority.

Cho phép admin tạo, sửa, nhân bản và xóa animation khỏi draft.

Không xóa animation đang được phiên bản published sử dụng.

---

# 8. DIRECTIONAL ANIMATIONS

Các action:

- walk_left
- walk_right
- run_left
- run_right

Phải tương ứng với hướng di chuyển thực tế.

Ưu tiên dùng frame riêng nếu có.

Nếu chỉ có frame một hướng, có thể dùng horizontal flip khi:

- Character design tương đối đối xứng.
- Không có chữ trên trang phục/vũ khí.
- Không làm sai hiệu ứng ánh sáng, kiếm hoặc kỹ năng.

Admin được bật/tắt `allowFlipX` theo animation.

Không tự flip một animation có hiệu ứng bất đối xứng khi gây lỗi hình ảnh.

Khi đổi hướng, sprite và head anchor phải được cập nhật đúng.

---

# 9. HITBOX, HURTBOX, PIVOT

Mỗi frame hỗ trợ:

- Pivot.
- Foot anchor.
- Body hurtbox.
- Attack hitbox.
- Optional collision box.

Trong Sprite Studio phải hiển thị được các vùng này.

Cho phép admin kéo chỉnh bằng chuột.

Phải phân biệt:

- Hitbox: vùng tấn công.
- Hurtbox: vùng nhận đòn.
- Collision box: vùng va chạm/chặn di chuyển.
- Pivot: điểm neo hiển thị.

Combat engine vẫn phải là authoritative ở backend.

Các hitbox được admin cấu hình là metadata để tính hit detection phù hợp với combat system, nhưng frontend không được tự ý quyết định HP hoặc Damage.

Nếu backend combat dùng collision đơn giản hóa, phải ghi rõ và bảo đảm nhất quán với preview.

---

# 10. SPRITE SIMULATOR — BẮT BUỘC

Admin phải có một trang Sprite Simulator riêng.

Route đề xuất:

`/admin/battle-assets/characters/[characterId]/simulator`

Đây là môi trường kiểm tra hoạt hình, không phải trận đấu TikTok thật.

### Controls

- Character selection.
- Animation selection.
- Play.
- Pause.
- Stop.
- Restart.
- Step forward one frame.
- Step backward one frame.
- Loop on/off.
- Animation speed.
- FPS preview.
- Zoom.
- Background selection.
- Show pivot.
- Show hitbox.
- Show hurtbox.
- Show ground line.
- Flip X.
- Adjust anchor.
- Fullscreen preview.

### Test modes

**Mode 1 — Single Animation**

Phát một animation theo timeline.

**Mode 2 — Direction Test**

Cho nhân vật di chuyển trái/phải thực tế và kiểm tra frame tương ứng.

**Mode 3 — Combat Test**

Cho hai nhân vật đánh nhau:

- Red xuất hiện bên trái.
- Blue xuất hiện bên phải.
- Hai nhân vật tiếp cận nhau.
- Tấn công.
- Bị đánh.
- Knockback.
- Fall.
- Die.

**Mode 4 — 9:16 OBS Preview**

Kiểm tra toàn bộ nhân vật, thanh HP, avatar và hiệu ứng trên canvas 1080×1920.

**Mode 5 — Stress Test**

Tạo nhiều bản sao nhân vật để kiểm tra FPS và bộ nhớ.

### Sprite Quality Checklist

Hiển thị trạng thái cho từng animation:

- Frame đầy đủ?
- Không bị crop mất chi tiết?
- Pivot ổn định?
- Foot anchor đúng?
- Hướng di chuyển đúng?
- Không giật vị trí quá lớn?
- Không sai tỷ lệ cơ thể?
- Không thiếu animation quan trọng?
- Không có nền ảnh chưa tách?
- Hitbox/hurtbox có hợp lệ?
- Animation không bị loop sai?
- Die giữ được frame cuối?

Các kiểm tra tự động chỉ đánh dấu nghi vấn; admin vẫn cần xem và phê duyệt bằng mắt.

---

# 11. ANIMATION APPROVAL WORKFLOW

Mỗi character asset có trạng thái:

```text
UPLOADED
PROCESSING
NEEDS_REVIEW
DRAFT
READY_FOR_TEST
APPROVED
PUBLISHED
ARCHIVED
FAILED
```

Quy trình:

```text
Upload
  ↓
Auto Detection
  ↓
Manual Frame Editing
  ↓
Animation Configuration
  ↓
Sprite Simulator
  ↓
Validation
  ↓
Admin Approval
  ↓
Publish
  ↓
Available in Battle Arena
```

Không tự động publish ảnh vừa upload.

Khi publish:

- Tạo version mới.
- Không ghi đè trực tiếp version trước.
- Lưu checksum.
- Lưu published timestamp.
- Lưu admin ID.
- Cho phép rollback.

Đấu trường đang chạy sử dụng phiên bản ổn định đã được pin.

Nếu admin cập nhật sprite giữa trận, mặc định áp dụng ở vòng đấu tiếp theo, không thay đổi asset đột ngột khi nhân vật đang tấn công.

---

# 12. INTEGRATION WITH BATTLE ENGINE

Hai nhân vật mặc định:

### Character 1

- ID: `tutien1`
- Name: Đao Pháp Huyết Ảnh
- Element: Fire
- Main color: Red
- Preferred initial spawn side: Left
- Preferred facing direction: Right

### Character 2

- ID: `tutien2`
- Name: Kiếm Khí Băng Lam
- Element: Ice
- Main color: Light Blue
- Preferred initial spawn side: Right
- Preferred facing direction: Left

Trong chế độ test hai nhân vật, luôn hiển thị Red bên trái và Blue bên phải để kiểm tra hướng.

Trong game hỗn chiến nhiều người, spawn position và sprite selection do Battle Engine xác định.

Mỗi người chơi TikTok có:

- TikTok nickname.
- TikTok avatar.
- Character definition ID.
- Character asset version.
- HP.
- Damage.
- Position.
- Combat state.

Avatar phải bám theo head anchor của sprite và hoạt động đúng khi scale hoặc flip.

Khi bị đánh:

1. Backend xác nhận hit.
2. Frontend phát `hit`.
3. HP bar giảm.
4. Phát knockback.
5. Chuyển về combat stance nếu còn sống.

Khi HP = 0:

1. Phát `fall`.
2. Sau khi fall kết thúc, phát `die`.
3. Giữ frame die cuối.
4. Khi vòng đấu kết thúc hoặc hết thời gian cấu hình, mới fade/despawn.

Không phát animation chết nhiều lần cho cùng một defeat event.

---

# 13. DATABASE & STORAGE

Bổ sung các model phù hợp với schema thực tế:

```text
BattleAsset
BattleAssetVersion
BattleCharacterDefinition
BattleAnimation
BattleAnimationFrame
BattleAssetValidation
BattleBackground
```

Cần có:

- Owner/admin metadata.
- Storage key.
- SHA-256 checksum.
- File MIME type.
- Asset version.
- Publication status.
- Animation metadata JSON.
- Validation results.
- CreatedAt/UpdatedAt.
- PublishedAt.

Các frame và atlas phải có storage URL ổn định, có versioning.

Không lưu toàn bộ ảnh PNG dạng base64 trong PostgreSQL.

Không sửa hoặc xóa các bảng Farm Công Đức hiện có.

---

# 14. SECURITY

Upload và xử lý ảnh phải bảo đảm:

- Xác thực admin.
- Backend permission checks.
- MIME validation bằng nội dung file.
- Image decode validation.
- Maximum upload size.
- Maximum image dimensions.
- Processing timeout.
- Memory limits.
- Safe file paths.
- Random storage keys.
- No path traversal.
- No arbitrary executable uploads.
- No shell command injection.
- No untrusted SVG execution.
- Asset serving with suitable content type.
- Audit log cho publish, rollback và delete.

Xử lý ảnh nặng ở worker có tài nguyên giới hạn, không block Node.js API event loop.

Không lưu asset trong thư mục bị xóa bởi Jenkins workspace cleanup hoặc Docker image rebuild.

---

# 15. TESTING REQUIREMENTS

### Sprite processing

- Import two source PNGs when available.
- Reject unsupported files.
- Detect candidate frames.
- Validate alpha transparency.
- Handle overlapping regions.
- Normalize canvas.
- Preserve character aspect ratio.
- Generate metadata.
- Detect corrupt images.
- Handle oversized images.

### Animation

- Independent frame duration.
- Correct frame ordering.
- Directional animation.
- Pivot consistency.
- Ground baseline stability.
- Attack event marker.
- Die hold-last-frame.
- Pause/step/loop playback.

### Admin UI

- Upload background.
- Upload sprite.
- Edit frame.
- Edit animation.
- Save draft.
- Preview.
- Approve.
- Publish.
- Rollback.
- Reject unauthorized user.

### Game integration

- Spawn Red and Blue.
- Face correct directions.
- Move and attack.
- Receive hit.
- Fall/die.
- Correct avatar head anchor.
- No missing texture.
- Restore after overlay reload.
- No regression in Farm Công Đức.

### Browser testing

Use Playwright or another existing browser testing approach to verify:

- Sprite canvas rendering.
- Frame change.
- Animation transitions.
- Admin simulator controls.
- Canvas 9:16 scaling.
- Assets loading after Docker restart.

If automatic image analysis cannot reliably judge visual quality, report manual review requirements.

---

# 16. BRANCH AND CI/CD SAFETY

All changes must stay in:

`feature/battle-arena`

No production deploy.

Use the test-only Jenkinsfile proposed in the previous prompt.

Do not alter production Jenkins credentials.

Do not modify production Compose project, volumes or database.

For testing asset storage, use isolated persistent volumes.

Do not merge into main automatically.

Create a Draft PR after implementation and tests.

---

# 17. IMPLEMENTATION PHASES

### Phase 1 — Code Audit
Inspect current Battle and Farm implementation, existing PixiJS renderer, asset locations and test infrastructure.

### Phase 2 — Asset Persistence
Create storage service, Prisma schema, upload API and safe asset versioning.

### Phase 3 — Sprite Processing
Implement segmentation, manual crop support, RGBA output, frame normalization and metadata export.

### Phase 4 — Sprite Studio UI
Build background manager, frame editor, animation timeline and properties panel.

### Phase 5 — Sprite Simulator
Implement animation controls, hitbox/pivot display, direction tests and two-character combat preview.

### Phase 6 — Battle Integration
Connect approved assets to authoritative Battle Engine and OBS renderer.

### Phase 7 — Regression Tests
Run all existing tests and verify Farm Công Đức, login, TikTok connector, AI, billing and CI safety.

### Phase 8 — Draft PR
Commit the verified changes and push only the feature branch.

---

# 18. ACCEPTANCE CRITERIA

This feature is complete only when:

1. Admin uploads a game background.
2. Admin updates and previews the background.
3. Admin uploads `tutien1.png` and `tutien2.png` when available.
4. The importer can propose frame regions from irregular AI-generated sprite sheets.
5. Admin can correct incorrectly detected frames.
6. Admin can remove backgrounds and export transparent frames.
7. Frames can be normalized without destroying character proportions.
8. Admin can create every required animation.
9. Admin can configure individual frame duration.
10. Admin can configure pivot, hitbox and hurtbox.
11. Admin can preview every animation.
12. Admin can play, pause, loop and step frames.
13. Admin can test left and right movement.
14. Admin can test attack, hit, fall and die.
15. Admin can test Red versus Blue in an isolated arena.
16. Admin can inspect the complete 9:16 OBS layout.
17. Admin can approve and publish asset versions.
18. Battle Arena loads approved assets.
19. Existing matches do not break when new versions are published.
20. Farm Công Đức remains functional.
21. Database changes are additive.
22. Tests pass or blockers are documented.
23. No production deployment occurs.
24. All work remains on the feature branch.

If the two original PNG files are missing, mark actual extraction and visual approval as BLOCKED_BY_ASSET, while completing all implementable infrastructure and tests with clearly identified fixtures.

Do not fabricate a successful sprite extraction result.

---

# 19. FINAL INSTRUCTION

Begin by auditing the current branch, source code and available asset files.

Implement Sprite Studio incrementally.

Prefer existing PixiJS over introducing an additional rendering engine.

Use deterministic tests and visual browser verification.

Keep the game engine independent of the asset editor.

Preserve Farm Công Đức and production CI/CD.

Commit verified changes only on `feature/battle-arena`.

Open a Draft PR to `main` without merging.

Report:

- Changed files.
- Database migrations.
- Available asset versions.
- Sprite processing results.
- Animation validation results.
- Automated test results.
- Visual tests requiring manual approval.
- Remaining blockers.
- Feature branch and commit SHA.
- Draft PR URL.

**The goal is a reusable browser-based sprite animation management system, not merely two hardcoded characters.**