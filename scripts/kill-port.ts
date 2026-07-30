/**
 * Kill any process listening on a given TCP port (Windows + Unix).
 *
 * Usage:
 *   bun run scripts/kill-port.ts 5173
 *   bun run scripts/kill-port.ts 5173 8787
 *
 * Cross-platform:
 *  - Windows: uses `netstat -ano` + `taskkill /T /F`
 *  - Unix (Linux/macOS): uses `lsof -ti :PORT` + `kill -9`
 *
 * Safe to call when nothing is on the port — exits 0 silently.
 * Used as a `predev` hook so the dev server never fails with
 * "Port 5173 is already in use" after a crashed previous run.
 */

const ports = process.argv.slice(2).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);

if (ports.length === 0) {
  console.error('Usage: bun run scripts/kill-port.ts <port> [<port> ...]');
  process.exit(1);
}

const isWin = process.platform === 'win32';

// On Windows we need System32 in PATH for taskkill/netstat to work even when
// the parent shell has a mangled PATH.
const pathSep = isWin ? ';' : ':';
const env = {
  ...process.env,
  PATH: isWin
    ? [
        process.env.SystemRoot ? `${process.env.SystemRoot}\\System32` : 'C:\\Windows\\System32',
        process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\Wbem` : '',
        process.env.PATH || '',
      ].filter(Boolean).join(pathSep)
    : process.env.PATH,
};

function killPid(pid: number | string) {
  const pidStr = String(pid).trim();
  if (!pidStr || pidStr === '0') return;
  if (isWin) {
    try {
      Bun.spawnSync(['taskkill', '/PID', pidStr, '/T', '/F'], {
        stdout: 'ignore',
        stderr: 'ignore',
        env,
      });
    } catch {
      // ignore — process may have already exited
    }
    return;
  }
  try {
    process.kill(Number(pidStr), 'SIGKILL');
  } catch {
    // ignore
  }
}

function killPort(port: number): number {
  if (isWin) {
    // netstat -ano | findstr :PORT
    let out = '';
    try {
      const r = Bun.spawnSync(['netstat', '-ano'], { env, stdout: 'pipe', stderr: 'ignore' });
      out = r.stdout ? new TextDecoder().decode(r.stdout) : '';
    } catch {
      return 0;
    }
    if (!out) return 0;

    // Lines like:  TCP    127.0.0.1:5173    0.0.0.0:0    LISTENING    12345
    const pids = new Set<string>();
    for (const line of out.split(/\r?\n/)) {
      // Match `:PORT <whitespace> ... <whitespace> PID` — must check exact port
      // to avoid matching 51730 / 51731 etc.
      const m = line.match(/[:\s](\d+)\s+\S+\s+\S+\s+(\d+)\s*$/);
      if (m && Number(m[1]) === port && m[2] !== '0') {
        pids.add(m[2]);
      }
    }
    if (pids.size === 0) return 0;

    let killed = 0;
    for (const pid of pids) {
      killPid(pid);
      killed++;
    }
    return killed;
  }

  // Unix: lsof -ti :PORT
  let out = '';
  try {
    const r = Bun.spawnSync(['lsof', '-ti', `:${port}`], { stdout: 'pipe', stderr: 'ignore' });
    out = r.stdout ? new TextDecoder().decode(r.stdout) : '';
  } catch {
    return 0;
  }
  if (!out.trim()) return 0;

  const pids = out.split(/\s+/).filter(Boolean);
  let killed = 0;
  for (const pid of pids) {
    killPid(pid);
    killed++;
  }
  return killed;
}

let total = 0;
for (const port of ports) {
  const killed = killPort(port);
  total += killed;
  if (killed > 0) {
    console.log(`[kill-port] killed ${killed} process(es) on port ${port}`);
  }
}

if (total > 0) {
  // Give the OS a moment to actually release the socket
  const ms = isWin ? 600 : 200;
  const start = Date.now();
  while (Date.now() - start < ms) {
    // busy-wait briefly
  }
}

process.exit(0);
