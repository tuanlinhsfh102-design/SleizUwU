# 📦 Build Sleiz Studio Desktop (.exe / .app / .deb / .tar.gz)

Hướng dẫn build Sleiz Studio thành native desktop app cho **Windows (.exe)**, **macOS (.dmg)**, và **Linux (.tar.gz)** sử dụng [ElectroBun](https://electrobun.dev).

> **TL;DR**: Tag `v0.2.0` để GitHub Actions tự build cho cả 3 platform. Hoặc build local bằng `bun build:desktop` (chỉ cho host platform hiện tại).

---

## 📋 Yêu cầu

| Tool | Version | Cài đặt |
|---|---|---|
| [Bun](https://bun.sh) | >= 1.1 | `curl -fsSL https://bun.sh/install \| bash` |
| Python 3 | >= 3.10 | (để generate icons) |
| Git | >= 2.30 | (để tag + push) |

Không cần cài ElectroBun riêng — `bun install` tự tải về.

---

## 🏗️ Cấu trúc build

```
apps/desktop/
├── electrobun.config.ts        ← config chính (TypeScript, KHÔNG phải .json)
├── package.json                ← scripts: dev / build / build:stable
├── src/
│   ├── bun/index.ts            ← main process (BrowserWindow + Updater + RPC)
│   ├── webview/preload.ts      ← bridge expose window.sleiz cho React app
│   └── shared/rpc-types.ts     ← typed RPC schema
├── scripts/
│   ├── pre-build.ts            ← chạy Vite build web bundle trước
│   └── post-build.ts           ← ghi build-manifest.json vào bundle
├── assets/
│   ├── icon.png                ← 512×512, Linux
│   ├── icon.ico                ← multi-size (16/32/48/64/128/256), Windows
│   └── icon.iconset/           ← PNGs nhiều size cho macOS (.iconset → .icns)
└── artifacts/                  ← output stable/canary builds (tự tạo)
```

---

## 🚀 Build Local (chỉ cho platform hiện tại)

### Bước 1: Cài dependencies

```bash
cd sleiz-studio
bun install
```

### Bước 2: Generate icons (lần đầu hoặc khi đổi logo)

```bash
bun build:icons
# → apps/desktop/assets/icon.png, icon.ico, icon.iconset/
```

### Bước 3: Build

```bash
# Dev build (không nén, chạy nhanh, có sourcemap)
bun build:desktop:dev

# Canary build (nén zstd, có update manifest, dùng cho beta test)
bun build:desktop:canary

# Stable build (production, nén tối ưu, dùng cho release)
bun build:desktop
```

Output:

```
apps/desktop/build/<env>-<platform>-<arch>/
  ├── SleizStudio[-canary]/      ← app bundle (chạy trực tiếp)
  │   └── Resources/
  │       ├── app.asar           ← code đã bundle
  │       ├── version.json       ← info cho Updater
  │       └── appIcon.png
  └── SleizStudio[-canary].tar.zst  ← nén để distribute

apps/desktop/artifacts/          ← (stable/canary only)
  ├── <env>-<platform>-<arch>-update.json      ← manifest cho auto-update
  └── <env>-<platform>-<arch>-SleizStudio[-canary].tar.zst
```

### Bước 4: Chạy thử build local

```bash
cd apps/desktop/build/dev-linux-x64/SleizStudio-dev/
./SleizStudio        # Linux
open SleizStudio.app # macOS
SleizStudio.exe      # Windows
```

---

## 🌍 Build Multi-Platform (qua GitHub Actions)

ElectroBun **không cross-compile** — cần build riêng cho mỗi OS. Cách dễ nhất là dùng GitHub Actions matrix.

### Bước 1: Push code lên GitHub

```bash
git add -A
git commit -m "feat: v0.2.0 - TikTok + Bilibili + auto-update"
git push origin main
```

### Bước 2: Tag release

```bash
# Stable release
git tag v0.2.0
git push origin v0.2.0

# Canary release (beta)
git tag v0.2.1-canary.1
git push origin v0.2.1-canary.1
```

Workflow `.github/workflows/build.yml` sẽ tự:

1. Chạy trên 4 runner song song:
   - `macos-14`  → macOS ARM64 (.dmg)
   - `macos-13`  → macOS x64 (.dmg)
   - `windows-latest` → Windows x64 (.zip chứa -Setup.exe)
   - `ubuntu-latest` → Linux x64 (.tar.gz)
2. Build web bundle (Vite)
3. Build desktop (ElectroBun)
4. Upload artifacts về GitHub
5. Tạo GitHub Release với tất cả artifacts (auto changelog)

### Bước 3: Download

Vào https://github.com/tuanlinhsfh102-design/SleizUwU/releases/latest

- **Windows**: tải `stable-win-x64-SleizStudio-Setup.zip`, giải nén, chạy `SleizStudio-Setup.exe`
- **macOS (Apple Silicon)**: tải `stable-macos-arm64-SleizStudio.dmg`, mở, kéo vào Applications
- **macOS (Intel)**: tải `stable-macos-x64-SleizStudio.dmg`
- **Linux**: tải `stable-linux-x64-SleizStudioSetup.tar.gz`, giải nén, chạy `./SleizStudio`

---

## 🔄 Auto-Update

### Cách hoạt động

1. App khởi động → đợi 30s → `Updater.checkForUpdate()`
2. Fetch `<baseUrl>/stable-<platform>-<arch>-update.json`
3. So sánh hash với local `version.json`
4. Nếu khác → tải patch `.patch` (BSDIFF, ~14KB) → apply
5. Nếu patch fail → tải full `.tar.zst` (~30-90MB)
6. Khi `updateReady === true` → hiện toast "Restart to update"
7. User bấm → `Updater.applyUpdate()` → quit + replace + relaunch

### Configure baseUrl

Sửa trong `apps/desktop/electrobun.config.ts`:

```ts
release: {
  // GitHub Releases (chỉ hoạt động cho stable, không cho canary)
  baseUrl: 'https://github.com/tuanlinhsfh102-design/SleizUwU/releases/latest/download',

  // HOẶC S3/R2 (hoạt động cho cả canary và stable)
  // baseUrl: 'https://your-bucket.s3.amazonaws.com/sleiz-studio/',
}
```

### Vô hiệu hóa auto-update

Set env var khi chạy:

```bash
SLEIZ_DISABLE_UPDATE=1 ./SleizStudio
```

Hoặc trong Settings → Updates tab, không bấm "Kiểm tra ngay".

### Publish artifacts

Sau khi build local:

```bash
# Copy artifacts lên S3
aws s3 sync apps/desktop/artifacts/ s3://your-bucket/sleiz-studio/

# HOẶC tạo GitHub Release và upload
gh release create v0.2.0 apps/desktop/artifacts/*
```

---

## 🔐 Code Signing (macOS)

Để app chạy không bị macOS Gatekeeper chặn:

### Bước 1: Lấy credentials từ Apple Developer

- **Developer ID Application certificate** (từ Apple Developer portal)
- **App-specific password** (từ appleid.apple.com)
- **Team ID** (10 ký tự, vd `BGU899NB8T`)

### Bước 2: Set env vars (local hoặc GitHub Secrets)

```bash
export ELECTROBUN_DEVELOPER_ID="My Corp Inc. (BGU899NB8T)"
export ELECTROBUN_TEAMID="BGU899NB8T"
export ELECTROBUN_APPLEID="myemail@email.com"
export ELECTROBUN_APPLEIDPASS="your-app-specific-password"
```

### Bước 3: Build

```bash
bun build:desktop
# → tự động codesign + Notarize
```

### Bước 4: Verify

```bash
codesign -dv --verbose=4 apps/desktop/build/stable-macos-arm64/SleizStudio.app
spctl -a -vvv -t exec apps/desktop/build/stable-macos-arm64/SleizStudio.app
```

### Unsigned app (cho dev)

Nếu không sign, user phải bypass manually:

```bash
xattr -cr /Applications/SleizStudio.app
open /Applications/SleizStudio.app
```

---

## 🪟 Windows-specific

### Build .exe

```bash
# Trên Windows hoặc GitHub Actions windows-latest runner
bun install
bun build:desktop
```

Output: `apps/desktop/build/stable-win-x64/SleizStudio-Setup.exe` (cài đặt) + `.zip` (portable).

### Console debug

Stable/canary build là GUI app (không có console). Để debug:

```cmd
set ELECTROBUN_CONSOLE=1
SleizStudio.exe
```

### Code signing Windows (tùy chọn)

ElectroBun dùng `rcedit` để set icon + version info. Để sign với cert:

```bash
# Cài signtool (Windows SDK)
# Set env vars
set ELECTROBUN_WINDOWS_CERT=path/to/cert.pfx
set ELECTROBUN_WINDOWS_CERTPASS=password
bun build:desktop
```

---

## 🐧 Linux-specific

ElectroBun bundle CEF (~150MB) cho Linux vì WebKitGTK có nhiều giới hạn. Cài dependencies:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libglib2.0-dev libnss3-dev libxss1 libasound2 \
  libgbm-dev libxshmfence-dev
```

Output: `apps/desktop/build/stable-linux-x64/SleizStudioSetup.tar.gz` (self-extracting).

---

## 🛠️ Troubleshooting

### `Core dependencies not found for linux-x64`

ElectroBun tự download core binaries (~100MB) lần đầu. Nếu fail:

```bash
rm -rf apps/desktop/node_modules/electrobun/dist-linux-x64
bun build:desktop
```

### `CEF dependencies not found`

Tương tự, CEF (~157MB) download lần đầu. Force re-download:

```bash
rm -rf apps/desktop/node_modules/electrobun/dist-linux-x64/cef
bun build:desktop
```

### `failed to copy ../web/dist/index.html because it doesn't exist`

Vite build chưa chạy. Thiếu `apps/web/dist/`. Fix:

```bash
bun --filter ./apps/web build   # build web trước
# hoặc
bun build:desktop:dev            # script pre-build sẽ tự chạy Vite
```

### `Build failed: hook script failed`

Pre-build/post-build hook fail. Xem log:

```bash
cd apps/desktop
bun run scripts/pre-build.ts    # chạy riêng để xem lỗi
bun run scripts/post-build.ts
```

### Auto-update không thấy bản mới

1. Verify `release.baseUrl` đúng trong `electrobun.config.ts`
2. Verify `<baseUrl>/stable-<platform>-<arch>-update.json` accessible (mở URL trong browser)
3. Verify `version.json` trong app bundle có hash khác với update.json
4. Canary builds **không** auto-update qua GitHub Releases (URL `/releases/latest/download` chỉ resolve stable). Dùng S3/R2 cho canary.

### App mở rồi đóng ngay

```bash
# Bật console debug
export ELECTROBUN_CONSOLE=1
./SleizStudio
# Xem lỗi trong console
```

---

## 📊 Build sizes (reference)

| Platform | Stable size | Canary size | Update patch |
|---|---|---|---|
| macOS arm64 | ~30 MB | ~30 MB | ~14 KB |
| macOS x64 | ~30 MB | ~30 MB | ~14 KB |
| Windows x64 | ~35 MB | ~35 MB | ~14 KB |
| Linux x64 (CEF) | ~90 MB | ~35 MB* | ~14 KB |

*Linux canary nhỏ hơn nếu CEF được share system-wide.

---

## 📚 Tham khảo

- [ElectroBun Docs](https://framework.blackboard.sh/electrobun/)
- [Build Configuration](https://framework.blackboard.sh/electrobun/apis/cli/build-configuration/)
- [Updater API](https://framework.blackboard.sh/electrobun/apis/updater/)
- [Code Signing](https://framework.blackboard.sh/electrobun/guides/code-signing/)
- [Cross-Platform Development](https://framework.blackboard.sh/electrobun/guides/cross-platform-development/)

---

**Vấn đề khi build?** Mở issue tại https://github.com/tuanlinhsfh102-design/SleizUwU/issues
