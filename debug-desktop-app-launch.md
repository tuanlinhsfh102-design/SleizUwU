# Debug Session: desktop-app-launch
- **Status**: [OPEN]
- **Issue**: Người dùng bật ứng dụng nhưng chỉ thấy bản web/local server, không lên được cửa sổ desktop native như mong đợi.
- **Debug Server**: Pending startup
- **Log File**: .dbg/trae-debug-log-desktop-app-launch.ndjson

## Reproduction Steps
1. Build/chạy bản desktop native từ `apps/desktop`.
2. Mở launcher của bản native Windows.
3. Quan sát app có tạo được cửa sổ desktop hay không.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Native launcher không spawn đúng tiến trình app/runtime | High | Low | Pending |
| B | App runtime khởi tạo được nhưng WebView2 controller fail nên không hiện desktop window | High | Low | Pending |
| C | Bản đang chạy thực chất là standalone web-hosted `.exe`, không phải native desktop bundle | Medium | Low | Pending |
| D | Đường dẫn resource/config trong native bundle sai nên app thoát sớm hoặc rơi về fallback | Medium | Medium | Pending |

## Log Evidence
Pending.

## Verification Conclusion
Pending.
