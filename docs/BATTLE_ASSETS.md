# Battle Arena Sprite Studio (nhánh `feature/battle-arena`)

## Môi trường thử nghiệm

`Jenkinsfile.battle` chỉ chạy kiểm tra và build image worker; không deploy. Job Jenkins test phải trỏ SCM tới `feature/battle-arena`, Script Path `Jenkinsfile.battle`. Jenkins production dùng `Jenkinsfile` hiện có và không chịu tác động từ nhánh này.

Chạy Docker test riêng:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.battle.yml up -d --build --wait
```

Mở `http://localhost:18091/admin/battle-assets`. Project Compose tên `tiktok-cungduong-battle-test`, cổng 18091, PostgreSQL/Redis/asset volume riêng. `battle-storage-init` cấp quyền ghi volume cho user `node`; volume không bị xóa khi build lại image. Worker xử lý ảnh chạy với giới hạn 768 MB RAM, 1 CPU, timeout 60 giây/job. Không dùng `docker compose down -v` nếu muốn giữ dữ liệu thử nghiệm.

## Quy trình

1. Admin (SUPER_ADMIN hoặc ADMIN có quyền `battle.assets.manage`; bootstrap cấp quyền này cho role ADMIN) upload background hoặc sprite PNG.
2. Với hai sprite sheet mẫu `tutien1.png` (xanh) và `tutien2.png` (đỏ), worker dùng profile đã đo trong `apps/sprite-worker/profiles.json`, OpenCV và Pillow để tự tách nền, cắt frame, gắn 15 animation và xuất atlas ngay sau upload. UI tự cập nhật khi render xong. Admin chỉ kiểm tra các frame có dấu ⚠, sửa crop/alpha/pivot/timeline khi cần và lưu nháp. Ảnh khác chưa có profile vẫn nhận crop `UNCLASSIFIED`; thêm profile theo checksum nguồn để mở rộng cho nhân vật khác.
3. Dùng crop (kéo, resize, tách/gộp), auto mask hoặc color key, erase/restore, padding và thuộc tính pivot/hitbox/hurtbox (có thể kéo trong preview) để sửa frame RGBA. Đánh dấu `Đã kiểm tra frame này` cho các frame bị cảnh báo. Lưu nháp để worker xuất lại PNG, atlas và metadata trên volume. Nút `Tạo phiên bản tự động mới` tạo version mới khi bản hiện tại đã có frame, giữ nguyên version cũ.
4. Gắn frame vào các animation, thời lượng từng frame, root motion, transition và event. Mở Sprite Simulator kiểm tra hướng di chuyển theo `walk_left`/`walk_right`, combat minh họa, khung 9:16 và FPS đo được.
5. Validate → Approve → Publish. Upload không tự publish. Phiên bản cũ vẫn có URL theo số version; rollback chỉ đổi con trỏ active.

Mỗi asset có checksum SHA-256 bản gốc, atlas có checksum riêng. Các file gốc và version được lưu tại `BATTLE_ASSET_ROOT` (mặc định `/var/lib/cungduong/battle-assets`). Ảnh thật mẫu nằm trong `assets/battle/source/`. Bản tự cắt được lưu ở trạng thái `NEEDS_REVIEW`, không tự publish. `quality.json` liệt kê PASS, REVIEW_REQUIRED hoặc FAIL; `metadata.json` phục vụ BattlePreview và `atlas.json` tương thích Phaser 3 Hash atlas.

Có thể tái tạo ra thư mục rỗng bằng CLI (chạy trong battle-worker image, có Pillow/NumPy/OpenCV):

```bash
python3 apps/sprite-worker/processor.py auto assets/battle/source/tutien1.png - /path/to/empty/blue
python3 apps/sprite-worker/processor.py auto assets/battle/source/tutien2.png - /path/to/empty/red
```

Mỗi thư mục xuất `source.png`, `frames/*.png`, `atlas.png`, `atlas.json`, `animations.json`, `metadata.json`, `quality.json`, `report.json`, `draft.json` và `preview.html`. CLI từ chối chạy nếu thư mục đích có file, nhằm giữ các chỉnh sửa đã duyệt. Phục vụ thư mục qua HTTP để mở `preview.html`.

## Kết quả hiện tại và điểm cần duyệt

Đã test pipeline với hai ảnh thật: `tutien1.png` tạo 84 frame, `tutien2.png` tạo 94 frame; cả hai có 15 timeline và không còn frame rỗng trong kiểm thử hiện tại. Vùng chồng hiệu ứng được đánh dấu REVIEW_REQUIRED, vẫn cần admin xem trước khi publish. File `arena-fight.png` là ảnh nền nhưng chưa có ground zone được duyệt.

Đã thử luồng end-to-end bằng sprite fixture nhân tạo trong database test: upload → render atlas → validate → approve → publish v1 → publish v2 → rollback v1. Tài khoản USER đọc được atlas v2 đã lưu (phục vụ trận đang pin version) và danh sách published, nhưng bị từ chối xem draft (HTTP 403). Fixture đã được dọn khỏi database/volume sau browser test. Ba ảnh thật vẫn chỉ ở trạng thái cần duyệt.

Đã thử tài khoản ADMIN đọc danh sách draft (HTTP 200), USER bị từ chối (HTTP 403); xóa fixture chưa publish trả HTTP 200, xóa dữ liệu/file và ghi một audit log `battle.asset.delete`.

Repository hiện không có Battle Engine backend hay trận đấu TikTok cho Tu Tiên Battle Arena. Sprite Simulator là môi trường preview độc lập; HP/damage ở đó chỉ minh họa. Tích hợp combat authoritative và pin version theo match cần một Battle Engine riêng trước khi sử dụng production. Farm Công Đức vẫn dùng renderer cũ.
