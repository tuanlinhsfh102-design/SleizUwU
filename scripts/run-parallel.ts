/**
 * Run multiple commands in parallel without cmd.exe / concurrently.
 *
 *   bun run scripts/run-parallel.ts hmr
 *   bun run scripts/run-parallel.ts all
 *
 * hmr = Vite web (HMR) + Electrobun desktop window
 * all = Vite web + standalone API
 */

const presets: Record<string, { name: string; args: string[] }[]> = {
  hmr: [
    { name: 'web', args: ['bun', '--filter', './apps/web', 'dev'] },
    { name: 'desktop', args: ['bun', '--filter', './apps/desktop', 'dev'] },
  ],
  all: [
    { name: 'web', args: ['bun', '--filter', './apps/web', 'dev'] },
    { name: 'api', args: ['bun', '--hot', './packages/api/src/server.ts'] },
  ],
};

const presetName = process.argv[2];
if (!presetName || !(presetName in presets)) {
  console.error(`Usage: bun run scripts/run-parallel.ts <${Object.keys(presets).join('|')}>`);
  process.exit(1);
}

const jobs = presets[presetName]!;
const children: { name: string; proc: ReturnType<typeof Bun.spawn> }[] = [];
let shuttingDown = false;

const pathSep = process.platform === 'win32' ? ';' : ':';
const env = {
  ...process.env,
  PATH: [
    process.env.SystemRoot ? `${process.env.SystemRoot}\\System32` : 'C:\\Windows\\System32',
    process.env.PATH || '',
  ].join(pathSep),
};

function prefix(name: string, chunk: Uint8Array, stream: NodeJS.WriteStream) {
  const text = new TextDecoder().decode(chunk);
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    stream.write(`[${name}] ${line}\n`);
  }
}

function killTree(pid: number) {
  if (!pid || pid <= 0) return;
  if (process.platform === 'win32') {
    try {
      Bun.spawnSync(['taskkill', '/PID', String(pid), '/T', '/F'], {
        stdout: 'ignore',
        stderr: 'ignore',
        env,
      });
    } catch {
      // ignore
    }
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore
  }
}

function spawnJob(name: string, args: string[]) {
  const proc = Bun.spawn(args, {
    cwd: process.cwd(),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'inherit',
  });

  void (async () => {
    const reader = proc.stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) prefix(name, value, process.stdout);
    }
  })();

  void (async () => {
    const reader = proc.stderr.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) prefix(name, value, process.stderr);
    }
  })();

  children.push({ name, proc });
  console.log(`[runner] started ${name}: ${args.join(' ')}`);
  return proc;
}

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[runner] shutting down child processes...');
  for (const { name, proc } of children) {
    console.log(`[runner] stopping ${name} (pid ${proc.pid})`);
    killTree(proc.pid);
  }
  setTimeout(() => process.exit(code), process.platform === 'win32' ? 500 : 0);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
// Windows-specific: when the parent terminal is closed, we get a CTRL_BREAK
// or the stdin pipe closes. Handle both so child Vite processes don't leak.
process.on('SIGBREAK', () => shutdown(0));
process.stdin.on('end', () => shutdown(0));
process.stdin.on('close', () => shutdown(0));

if (presetName === 'hmr') {
  console.log('[runner] Starting Vite + Electrobun desktop app...');
  console.log('[runner] Desktop window opens after electrobun pre-build (~10–20s).');
}

for (const job of jobs) {
  spawnJob(job.name, job.args);
}

const codes = await Promise.all(
  children.map(async ({ name, proc }) => {
    const code = await proc.exited;
    if (!shuttingDown) {
      console.log(`[runner] ${name} exited with code ${code}`);
      shutdown(code === 0 ? 0 : 1);
    }
    return code ?? 1;
  }),
);

if (!shuttingDown) {
  shutdown(codes.some((c) => c !== 0) ? 1 : 0);
}
