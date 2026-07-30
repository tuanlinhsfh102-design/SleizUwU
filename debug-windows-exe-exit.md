# Debug Session: windows-exe-exit
- **Status**: [OPEN]
- **Issue**: Double-clicking `release/windows/SleizStudio.exe` opens a console briefly and then exits immediately.
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: .dbg/trae-debug-log-windows-exe-exit.ndjson

## Reproduction Steps
1. Open `release/windows/SleizStudio.exe` or `release/windows/Start-SleizStudio.bat`.
2. Observe the console window opens briefly.
3. The process exits before the app remains available at `http://localhost:8787`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `web/index.html` is missing or web bundle path is wrong, so startup aborts before serving UI. | Medium | Low | Rejected |
| B | Database or storage initialization fails and exits the process during startup. | Medium | Low | Rejected |
| C | A startup exception exists but only surfaces on stderr, so double-click makes it look like the app closes silently. | High | Low | Confirmed |
| D | Port `8787` is already occupied, and the standalone build exits because it hardcodes that port. | High | Low | Confirmed |

## Log Evidence
- `trae-debug-log-windows-exe-exit.ndjson`
  - `pre-fix`
    - `A`: startup paths resolved, `webIndexExists: true`
    - `B`: database initialization completed with `data/sleiz.db`
    - `D`: attempting to start standalone server on `127.0.0.1:8787`
    - `C`: uncaught exception monitor captured `Failed to start server. Is port 8787 in use?`
  - `post-fix`
    - `A`: startup paths resolved, `webIndexExists: true`
    - `B`: database initialization completed with `data/sleiz.db`
    - `D`: standalone server attempted with `requestedPort: 8787` and switched to `port: 8788`
    - `D`: standalone server started successfully on `127.0.0.1:8788`
    - `D`: browser open requested on Windows via `explorer.exe`
    - HTTP access log shows `/` and bundled assets returning `200`
- Port ownership check:
  - `127.0.0.1:8787` is already listening
  - owner process: `bun.exe` from `C:\Users\Admin\AppData\Local\ai.sleiz.studio\stable\app\bin\bun.exe`

## Verification Conclusion
Root cause confirmed: the standalone Windows executable hardcodes port `8787`, but another Sleiz-related process is already bound to that port. The executable exits immediately after `serve(...)` throws, which is why double-clicking appears to open and close the console instantly.

Post-fix verification shows the executable now probes for a free port, falls back from `8787` to `8788`, keeps running, returns `200` from `/`, returns a healthy JSON payload from `/api/health`, and requests browser opening via `explorer.exe` on Windows.
