/**
 * Shared TypeScript shape of the `window.electronAPI` I2P IPC surface.
 *
 * Mirrors the surface exposed by `electron/src/preload.ts`. Kept in its
 * own file (instead of co-located with `i2p.ts` or `i2pPlugin.ts`) to
 * avoid a circular type-import between those two modules — both files
 * import this type, but never each other for typing purposes.
 */
export interface ElectronI2PAPI {
  i2pInvoke(method: string, ...args: unknown[]): Promise<unknown>;
  onI2pEvent(event: string, cb: (data: unknown) => void): () => void;
}
