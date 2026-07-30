/**
 * Bun currently throws on node:v8.startupSnapshot.isBuildingSnapshot().
 * Recent bson/mongodb packages call that during module init.
 * Patch before importing mongodb.
 */
export function patchBunV8Snapshot() {
  try {
    const getBuiltinModule = (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process
      ?.getBuiltinModule;
    if (!getBuiltinModule) return;
    const v8 = getBuiltinModule('v8') as { startupSnapshot?: { isBuildingSnapshot?: () => boolean } } | undefined;
    if (!v8) return;
    Object.defineProperty(v8, 'startupSnapshot', {
      value: { isBuildingSnapshot: () => false },
      configurable: true,
      writable: true,
    });
  } catch {
    // ignore
  }
}

patchBunV8Snapshot();
