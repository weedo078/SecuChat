import sodiumWrappers from "libsodium-wrappers";

/**
 * Custom error thrown when libsodium fails to load (missing native binary,
 * platform not supported, etc.). The Electron-Main catches this and shows
 * the user a hint that LeaseSet-Publishing is unavailable.
 */
export class LibsodiumLoadError extends Error {
  constructor(cause: unknown) {
    super(
      `libsodium failed to load — LeaseSet-Publishing requires the X25519 ` +
        `mapping library. ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "LibsodiumLoadError";
  }
}

export type Libsodium = typeof sodiumWrappers;

let cachedPromise: Promise<Libsodium> | undefined;
let cachedSodium: Libsodium | undefined;
let sodiumReady = false;

/**
 * Lazy-Singleton-Loader für libsodium. Erstaufruf kann ~50ms dauern
 * (Native-Modul-Init). Folgeaufrufe sind sofort (Cache-Hit).
 *
 * Throws LibsodiumLoadError, wenn das Native-Modul nicht geladen werden
 * kann. Caller (Electron-Main) muss diesen Fall abfangen und dem User
 * einen Hinweis zeigen.
 *
 * ADAPTATION from brief Step 4: libsodium-wrappers is itself a Promise.
 * `await sodiumWrappers` resolves to the sodium object, but the actual
 * crypto APIs are NOT yet attached — they are added only once `s.ready`
 * (also a Promise) resolves. loadLibsodium therefore awaits both stages
 * before flipping the internal ready-flag and caching the resolved
 * instance, so that the sync mapping functions below can safely call
 * into the API.
 */
export async function loadLibsodium(): Promise<Libsodium> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    try {
      const sodium = await sodiumWrappers;
      await sodium.ready;
      cachedSodium = sodium;
      sodiumReady = true;
      return sodium;
    } catch (cause) {
      // Reset cachedPromise so a later retry can succeed (e.g. after a
      // missing-binary workaround is applied).
      cachedPromise = undefined;
      throw new LibsodiumLoadError(cause);
    }
  })();
  return cachedPromise;
}

function getSodiumOrThrow(): Libsodium {
  if (!sodiumReady || !cachedSodium) {
    throw new Error(
      "libsodium not ready — call loadLibsodium() and await it before " +
        "using ed25519PkToCurve25519 / ed25519SkToCurve25519",
    );
  }
  return cachedSodium;
}

/**
 * Ed25519 public-key (32B) → Curve25519 public-key (32B) für
 * ECDH mit dem aus dem Ed25519-Secret abgeleiteten Curve25519-Secret.
 * Konform zu libsodium `crypto_sign_ed25519_pk_to_curve25519`.
 *
 * Throws wenn die Eingabe nicht genau 32 Bytes ist, kein gültiger
 * Edwards-Punkt ist, oder libsodium noch nicht via loadLibsodium()
 * initialisiert wurde.
 */
export function ed25519PkToCurve25519(pk: Uint8Array): Uint8Array {
  if (pk.length !== 32) {
    throw new Error(
      `ed25519PkToCurve25519: expected 32 bytes, got ${pk.length}`,
    );
  }
  const sodium = getSodiumOrThrow();
  return sodium.crypto_sign_ed25519_pk_to_curve25519(pk);
}

/**
 * Ed25519 32-byte-SEED → Curve25519 32-byte-Secret.
 *
 * ADAPTATION from brief Step 4: libsodium's
 * `crypto_sign_ed25519_sk_to_curve25519` expects the 64-byte EXPANDED
 * Ed25519 secret-key (32B seed-derived scalar || 32B public-key), not
 * the 32B seed alone. Internally we expand the 32B seed via
 * `crypto_sign_seed_keypair` to obtain the 64B form, then hand it to
 * the libsodium mapper. The public-API contract (32B seed in, 32B
 * X25519 secret out) is preserved.
 */
export function ed25519SkToCurve25519(sk: Uint8Array): Uint8Array {
  if (sk.length !== 32) {
    throw new Error(
      `ed25519SkToCurve25519: expected 32 bytes (Ed25519 seed), got ${sk.length}`,
    );
  }
  const sodium = getSodiumOrThrow();
  // Expand 32B Ed25519 seed → 64B Ed25519 sk via libsodium's standard
  // SHA-512(key expansion) + scalar clamping, then map to X25519.
  const kp = sodium.crypto_sign_seed_keypair(sk);
  return sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey);
}
