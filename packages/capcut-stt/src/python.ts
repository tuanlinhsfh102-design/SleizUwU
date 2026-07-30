/**
 * Cross-platform Python spawn helper.
 *
 * On Windows, `python3` is not installed by default — only `python` (3.12 at
 * `C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe`) and
 * the `py` launcher are available. On Linux/macOS, `python3` is the standard.
 *
 * `uv_spawn` errors from Bun/Node come from the OS reporting ENOENT when the
 * binary is missing. We try them in order and fall through to the next one
 * if the previous one fails to spawn.
 *
 * Mirrors the same fallback used in `packages/video-processor/src/ffmpeg.ts`.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export const PYTHON_BINARIES = ['python3', 'python', 'py'] as const;
export type PythonBinary = (typeof PYTHON_BINARIES)[number];

export interface SpawnResult {
  /** The binary that was actually used (may be a fallback). */
  binary: PythonBinary;
  /** The child process handle. Caller is responsible for wiring up listeners. */
  process: ChildProcess;
}

export interface SpawnPythonOptions extends Omit<SpawnOptions, 'stdio'> {
  stdio?: SpawnOptions['stdio'];
  /** Called with the binary name each time we fall through. Useful for logging. */
  onFallback?: (tried: PythonBinary, err: NodeJS.ErrnoException) => void;
}

/**
 * Spawn a Python child process, trying each candidate binary in order until
 * one succeeds. Rejects with a descriptive error only if every candidate is
 * missing (ENOENT). Other spawn errors (non-ENOENT) are forwarded as-is.
 */
export function spawnPython(
  args: readonly string[],
  options: SpawnPythonOptions = {}
): Promise<SpawnResult> {
  const { onFallback, ...spawnOptions } = options;
  const stdio = spawnOptions.stdio ?? ['ignore', 'pipe', 'pipe'];

  return new Promise<SpawnResult>((resolve, reject) => {
    let idx = 0;

    const tryNext = (): void => {
      if (idx >= PYTHON_BINARIES.length) {
        reject(
          new Error(
            `No Python binary found (tried ${PYTHON_BINARIES.join(', ')}). ` +
              `Install Python 3 and ensure it is on PATH.`
          )
        );
        return;
      }
      const binary = PYTHON_BINARIES[idx++];

      let child: ChildProcess;
      try {
        child = spawn(binary, args, { ...spawnOptions, stdio });
      } catch (err) {
        // Some platforms throw synchronously on missing binary.
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') {
          onFallback?.(binary, e);
          tryNext();
          return;
        }
        reject(e);
        return;
      }

      // `spawn` is async on Windows for the ENOENT signal — we have to wait
      // for the 'spawn' event (fires only when the child actually started)
      // before resolving. Guard with a flag so we don't double-resolve
      // if 'spawn' and 'error' race.
      let settled = false;

      child.once('error', (err) => {
        if (settled) return;
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') {
          onFallback?.(binary, e);
          tryNext();
          return;
        }
        settled = true;
        reject(err);
      });

      // 'spawn' fires when the child has been successfully launched.
      // ENOENT does NOT fire 'spawn' — it fires 'error' instead. So this
      // is the reliable signal that the binary exists and ran.
      child.once('spawn', () => {
        if (settled) return;
        settled = true;
        resolve({ binary, process: child });
      });
    };

    tryNext();
  });
}
