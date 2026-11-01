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
2. Worker xác thực ảnh bằng Pillow, tạo thumbnail và đề xuất crop `UNCLASSIFIED`. Các đề xuất có thể lẫn nhãn, vũ khí hoặc hiệu ứng; sửa thủ công trong Frame Editor.
3. Dùng crop, color key, erase/restore, padding và thuộc tính pivot/hitbox/hurtbox để tạo frame RGBA. Lưu bản nháp để worker xuất PNG, atlas và metadata trên volume.
4. Gắn frame vào các animation, thời lượng từng frame và event. Mở Sprite Simulator kiểm tra hướng, combat minh họa, khung 9:16 và FPS.
5. Validate → Approve → Publish. Upload không tự publish. Phiên bản cũ vẫn có URL theo số version; rollback chỉ đổi con trỏ active.

Mỗi asset có checksum SHA-256 bản gốc, atlas có checksum riêng. Các file gốc và version được lưu tại `BATTLE_ASSET_ROOT` (mặc định `/var/lib/cungduong/battle-assets`). Ảnh thật mẫu nằm trong `assets/battle/source/` để admin upload; không được xem là animation đã hoàn thiện.

## Kết quả hiện tại và điểm cần duyệt

Đã test upload `tutien1.png`, `tutien2.png`, `arena-fight.png` trên Docker riêng. Phiên bản thử nghiệm của hai ảnh ở trạng thái `NEEDS_REVIEW`; chưa phê duyệt và chưa publish. Mô tả trong yêu cầu không khớp màu ảnh thật: `tutien1.png` là nhân vật xanh/băng, `tutien2.png` là nhân vật đỏ/lửa. Cần admin quyết định gán code/hệ trước khi publish. Các crop tự động là gợi ý, không thay thế kiểm tra bằng mắt. File `arena-fight.png` là ảnh nền nhưng chưa có ground zone được duyệt.

Đã thử luồng end-to-end bằng sprite fixture nhân tạo trong database test: upload → render atlas → validate → approve → publish v1 → publish v2 → rollback v1. Tài khoản USER đọc được atlas v2 đã lưu (phục vụ trận đang pin version) và danh sách published, nhưng bị từ chối xem draft (HTTP 403). Fixture đã được dọn khỏi database/volume sau browser test. Ba ảnh thật vẫn chỉ ở trạng thái cần duyệt.

Đã thử tài khoản ADMIN đọc danh sách draft (HTTP 200), USER bị từ chối (HTTP 403); xóa fixture chưa publish trả HTTP 200, xóa dữ liệu/file và ghi một audit log `battle.asset.delete`.

Repository hiện không có Battle Engine backend hay trận đấu TikTok cho Tu Tiên Battle Arena. Sprite Simulator là môi trường preview độc lập; HP/damage ở đó chỉ minh họa. Tích hợp combat authoritative và pin version theo match cần một Battle Engine riêng trước khi sử dụng production. Farm Công Đức vẫn dùng renderer cũ.
