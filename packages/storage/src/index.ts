/**
 * @sleiz/storage - Simple file storage abstraction used by download routes.
 */
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

export class FileStorage {
  constructor(private baseDir: string) {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  get dir(): string {
    return this.baseDir;
  }

  /**
   * Ensure the base storage directory exists. No-op if already present
   * (constructor already mkdir'd it, but this is idempotent and safe to
   * call from anywhere). Matches the legacy API used by download routes.
   */
  async ensure(): Promise<string> {
    await fsp.mkdir(this.baseDir, { recursive: true });
    return this.baseDir;
  }

  /** Resolve a relative path inside the storage dir, preventing path traversal. */
  resolve(rel: string): string {
    const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = path.join(this.baseDir, safe);
    if (!full.startsWith(path.resolve(this.baseDir))) {
      throw new Error('Path traversal detected');
    }
    return full;
  }

  async ensureDir(rel: string): Promise<string> {
    const full = this.resolve(rel);
    await fsp.mkdir(full, { recursive: true });
    return full;
  }

  async write(rel: string, data: Buffer | Uint8Array | string): Promise<string> {
    const full = this.resolve(rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, data);
    return full;
  }

  async read(rel: string): Promise<Buffer> {
    const full = this.resolve(rel);
    return fsp.readFile(full);
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fsp.access(this.resolve(rel));
      return true;
    } catch {
      return false;
    }
  }

  async remove(rel: string): Promise<void> {
    try {
      await fsp.unlink(this.resolve(rel));
    } catch {
      /* ignore */
    }
  }

  async size(rel: string): Promise<number> {
    const stat = await fsp.stat(this.resolve(rel));
    return stat.size;
  }
}
