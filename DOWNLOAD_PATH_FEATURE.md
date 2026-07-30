# Tính năng chọn đường dẫn tải phim

## Tổng quan
Đã thêm tính năng cho phép người dùng tùy chỉnh thư mục lưu trữ file phim tải về từ Bilibili và TikTok.

## Thay đổi

### 1. Database Schema
- Thêm cột `download_path` vào bảng `settings`
- Migration tự động chạy khi khởi động ứng dụng

### 2. Backend API
- Cập nhật `packages/api/src/routes/settings.ts`:
  - Thêm `downloadPath` vào danh sách các trường có thể cập nhật
  - Trả về `downloadPath` trong response

- Cập nhật `packages/api/src/routes/bilibili.ts`:
  - Đọc `downloadPath` từ settings
  - Sử dụng đường dẫn mặc định nếu chưa cấu hình

- Cập nhật `packages/api/src/routes/tiktok.ts`:
  - Đọc `downloadPath` từ settings
  - Sử dụng đường dẫn mặc định nếu chưa cấu hình

### 3. Frontend UI
- Thêm tab "Thư mục tải phim" trong Settings (Advanced)
- Cho phép người dùng:
  - Nhập đường dẫn thủ công
  - Chọn thư mục qua dialog (chỉ trên desktop)
  - Xem đường dẫn hiện tại
  - Xem cấu trúc thư mục con

### 4. Type Definitions
- Cập nhật interface `AppSettings` trong `packages/shared/src/types/index.ts`
- Thêm trường `downloadPath?: string | null`

## Đường dẫn mặc định

### Windows
```
C:\Users\[Username]\Downloads\SleizVietsubDownload
```

### macOS
```
~/Downloads/SleizVietsubDownload
```

### Linux
```
~/Downloads/SleizVietsubDownload
```

## Cấu trúc thư mục

Trong thư mục đã chọn, hệ thống tự động tạo các thư mục con:

```
[download_path]/
├── bilibili/
│   └── videos/         # Video Bilibili (MP4)
└── tiktok/
    ├── videos/         # Video TikTok (MP4)
    └── music/          # Nhạc TikTok (MP3)
```

## Cách sử dụng

1. Mở Settings (Alt+,)
2. Chuyển sang tab "Advanced"
3. Tìm card "Thư mục tải phim"
4. Nhập đường dẫn hoặc bấm "Chọn thư mục" (trên desktop)
5. Bấm "Lưu đường dẫn"

## Lưu ý

- Thư mục sẽ được tự động tạo nếu chưa tồn tại
- Nếu để trống, hệ thống sẽ sử dụng đường dẫn mặc định
- Có thể sử dụng cả đường dẫn tuyệt đối và tương đối
- Thay đổi đường dẫn không ảnh hưởng đến các file đã tải trước đó

## Ưu điểm

✅ Mặc định lưu vào thư mục Downloads quen thuộc
✅ Tự động tạo thư mục SleizVietsubDownload để tách biệt
✅ Cấu trúc thư mục rõ ràng (bilibili/tiktok)
✅ Dễ dàng tìm và quản lý file đã tải
✅ Hỗ trợ tất cả các nền tảng (Windows, macOS, Linux)
