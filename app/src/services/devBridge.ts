// app/src/services/devBridge.ts
//
// TEST-ONLY — niemals in Production aktivieren.
//
// Diese Datei stellt eine Programmatic Bridge bereit, die im Test-Modus (d. h.
// localStorage 'secuchat_test_mode' === '1') auf window.__secuchatDevBridge
// installiert wird. Sie erweitert die bestehende window.__i2pDebug-Infrastruktur
// um Routen für Kontakt-/Chat-Operationen.
//
// Zwei Zugriffswege werden unterstützt:
//   1. **CDP** (primär, schnell): Über `adb forward` auf webview_devtools_remote
//      und Chrome DevTools Protocol `Runtime.evaluate` wird
//      `window.__secuchatDevBridge.X(...)` aufgerufen. Das ist die
//      .tmp/run-samples.sh-Strategie.
//   2. **DevBridgePlugin** (Fallback): Der lokale TCP-Server auf 127.0.0.1:8787
//      wird via `adb reverse tcp:8787 tcp:8787` vom Host aus erreichbar. Er
//      ruft dieselben window.__secuchatDevBridge-Funktionen via
//      `getBridge().eval()` auf.

import { registerPlugin } from '@capacitor/core';
import { isTestMode, TEST_PASSPHRASE } from '@/utils/testMode';
import { storageService } from './storage';
import { cryptoService } from './crypto';

declare global {
  interface Window {
    __secuchatDevBridge?: DevBridgeAPI;
  }
}

export interface DevBridgeAPI {
  /** Liefert { username, b32, fingerprint, pgpPublicKey } des eingeloggten Users. */
  getIdentity(): Promise<DevBridgeResponse<IdentityPayload>>;

  /** Liefert alle Kontakte. */
  getContacts(): Promise<DevBridgeResponse<Contact[]>>;

  /** Liefert alle Chats. */
  getChats(): Promise<DevBridgeResponse<ChatSummary[]>>;

  /** Liefert einen kompletten App-State-Snapshot. */
  getState(): Promise<DevBridgeResponse<StatePayload>>;

  /** Exportiert die eigene Identität als .secuchat-Datei (v2-Format). */
  exportContact(): Promise<DevBridgeResponse<{ filename: string; path: string; content: string }>>;

  /** Importiert eine .secuchat-Datei und legt den Kontakt an. */
  importContact(body: string | ContactImportPayload): Promise<DevBridgeResponse<{ contactId: string }>>;

  /** Erzeugt einen Chat zu einem Kontakt. */
  createChat(body: string | { contactId: string }): Promise<DevBridgeResponse<{ chatId: string }>>;

  /** Sendet eine Textnachricht im aktiven Chat. */
  sendMessage(body: string | { contactId: string; text: string }): Promise<DevBridgeResponse<{ messageId: string }>>;

  /** Löscht einen Kontakt. */
  deleteContact(body: string | { contactId: string }): Promise<DevBridgeResponse<{ deleted: true }>>;

  /** Setzt die Verschlüsselungs-Passphrase und löst Reload aus. Test-only. */
  unlock(body: string | { passphrase: string }): Promise<DevBridgeResponse<{ unlocked: boolean }>>;

  /** Aktiviert Test-Mode und startet den nativen Server. Test-only. */
  enableTestMode(): Promise<DevBridgeResponse<{ enabled: boolean }>>;

  /** Triggert Auto-Onboarding (Onboarding-Komponente reagiert auf das Flag). */
  triggerAutoOnboard(opts?: string | { host?: string; username?: string; deviceName?: string }): Promise<DevBridgeResponse<{ triggered: boolean }>>;

  /** Debug-Inspektor: localStorage-Stand + pgpPrivateKey-Prefix. Test-only. */
  debugState(): Promise<DevBridgeResponse<{ testMode: string | null; testPw: string | null; pgpPrivateKeyPrefix: string; pgpPrivateKeyLen: number }>>;

  /** Listet ALLE User-Records in IndexedDB (für Multi-User-Diagnose). Test-only. */
  listAllUsers(): Promise<DevBridgeResponse<{ count: number; users: Array<{ id: string; pkLen: number; i2pAddr?: string }> }>>;

  /** Löscht ALLE User-Records in IndexedDB. Test-only — Datenverlust! */
  clearAllUsers(): Promise<DevBridgeResponse<{ deleted: number }>>;

  /**
   * Diagnose: liest AppContext-State (nur aktiv im Test-Mode).
   * Vergleicht UI-State mit Roh-IDB.
   */
  /** Diagnose: probiert mehrere Passphrase-Kandidaten und zeigt, welche entschlüsselt. Test-only. */
  tryDecrypt(): Promise<DevBridgeResponse<{
    userId?: string;
    rawLen: number;
    hasV2Prefix: boolean;
    directAesGcm: { ok: boolean; len?: number; prefix?: string; err?: string };
    viaDecryptData: Array<{ passphrase: string; ok: boolean; prefix?: string; len?: number; err?: string }>;
  }>>;

  /** Liest den ersten User aus IDB und gibt das volle pgpPrivateKey-Feld zurück. */
  tryDecryptIdb(): Promise<DevBridgeResponse<{
    userId?: string;
    pkFull?: string;
    pkLen: number;
    pkIsBase64: boolean;
  }>>;

  /** Self-Test: encryptData → decryptData mit TEST_PASSPHRASE. Test-only. */
  tryDecryptSelf(): Promise<DevBridgeResponse<{
    passphrase: string;
    ctPrefix: string;
    ctLen: number;
    decOk: boolean;
    dec: string | null;
    err: string | null;
  }>>;

  /** Realistic-Test: encryptData → decryptData mit ~2KB Plaintext. Test-only. */
  tryDecryptRealistic(): Promise<DevBridgeResponse<{
    passphrase: string;
    plainLen: number;
    ctLen: number;
    decOk: boolean;
    decLen: number | null;
    decStart: string | null;
    err: string | null;
  }>>;

  appDebugState(): Promise<DevBridgeResponse<{
    chatsCount: number;
    contactsCount: number;
    chatsFirst: { id: string; contactId: string; hasContactField: boolean; contactName?: string } | null;
    contactsFirst: { id: string; name: string } | null;
    isLocked: boolean;
    isAuthenticated: boolean;
  }>>;

  /**
   * Räumt Legacy-Datenmüll auf:
   *  1. Shadow-Kontakte (mehrere Kontakte mit gleicher i2pAddress) →
   *     behält den aktuellsten (lastSeen), löscht die anderen inklusive
   *     ihrer Chats + Messages.
   *  2. Orphan-Chats (contactId zeigt auf nicht mehr existierenden Kontakt).
   *  3. Kaputte Kontakte: name === '?' UND kein pgpPublicKey.
   *
   * Test-only — idempotent, sicher in Production-Schema wenn keine Duplikate
   * existieren.
   */
  clearStaleContacts(): Promise<
    DevBridgeResponse<{
      scannedContacts: number;
      removedDuplicates: number;
      removedOrphanChats: number;
      removedBrokenContacts: number;
      remainingContacts: number;
      remainingChats: number;
    }>
  >;
}

export interface DevBridgeResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export interface IdentityPayload {
  username: string;
  b32: string;
  fingerprint: string;
  pgpPublicKey: string;
  i2pPublicKey?: string;
}

export interface Contact {
  id: string;
  name: string;
  fingerprint: string;
  i2pAddress: string;
  pgpPublicKey: string;
  status: string;
  lastSeen?: string;
}

export interface ChatSummary {
  id: string;
  contactId: string;
  contactName: string;
  lastMessageTimestamp?: string;
  unreadCount: number;
}

export interface StatePayload {
  i2pStatus: string;
  contacts: Contact[];
  chats: ChatSummary[];
  identity: IdentityPayload | null;
}

export interface ContactImportPayload {
  // v2-Kontaktdatei (kurze Felder)
  v: '2';
  t: 'sc';
  n: string;
  i: string;
  f: string;
  k?: string;
  ts?: number;
  // optional: vollständiger Name statt kurzem
  name?: string;
  pgpPublicKey?: string;
}

const DevBridgeNative = registerPlugin<{
  setEnabled: (opts: { enabled: boolean }) => Promise<void>;
}>('DevBridge');

let installed = false;

/**
 * Installiert die Dev-Bridge. Wird einmal pro App-Start aufgerufen, gated auf
 * isTestMode(). Idempotent — Mehrfachaufrufe sind noop.
 */
export async function installDevBridge(): Promise<void> {
  if (installed) return;

  // Die Bridge-API wird IMMER auf window installiert, damit ein CLI-Befehl
  // sie aktivieren kann (z.B. nach `pm clear` ohne localStorage-Flags).
  // Der native TCP-Server wird IMMER gestartet — Production-Builds öffnen
  // damit zwar den Port, aber die JS-API lehnt jeden Aufruf ab, wenn
  // !isTestMode() (siehe enableTestMode/unlock/triggerAutoOnboard).
  installed = true;

  window.__secuchatDevBridge = createBridgeAPI();
  console.log('[DevBridge] window.__secuchatDevBridge installed', { testMode: isTestMode() });

  // Native Server starten — kein Gate mehr. Production-Builds: bridge-API
  // prüft isTestMode() selbst und gibt {ok:false,error:'test mode required'}
  // zurück, wenn nicht aktiv.
  try {
    await DevBridgeNative.setEnabled({ enabled: true });
    console.log('[DevBridge] native TCP server enabled on 127.0.0.1:8888');
  } catch (e) {
    console.warn('[DevBridge] native plugin enable failed (CDP-only mode):', e);
  }
}

function createBridgeAPI(): DevBridgeAPI {
  return {
    async getIdentity() {
      try {
        const user = await storageService.getUser();
        if (!user) return { ok: false, error: 'no user' };

        // user.i2pAddress is the authoritative source: i2pService.initialize()
        // syncs any drift between the persisted record and the live SAM
        // session back into storage on every startup. See
        // services/i2p.ts → syncB32ToUser().
        return {
          ok: true,
          result: {
            username: user.username,
            b32: user.i2pAddress,
            fingerprint: user.fingerprint,
            pgpPublicKey: user.pgpPublicKey,
            i2pPublicKey: user.i2pPublicKey,
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async getContacts() {
      try {
        const contacts = await storageService.getAllContacts();
        return {
          ok: true,
          result: contacts.map((c) => ({
            id: c.id,
            name: c.name,
            fingerprint: c.fingerprint,
            i2pAddress: c.i2pAddress,
            pgpPublicKey: c.pgpPublicKey,
            status: c.status,
            lastSeen: c.lastSeen,
          })),
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async getChats() {
      try {
        const chats = await storageService.getAllChats();
        const contacts = await storageService.getAllContacts();
        return {
          ok: true,
          result: chats.map((chat) => {
            const contact = contacts.find((c) => c.id === chat.contactId);
            return {
              id: chat.id,
              contactId: chat.contactId,
              contactName: contact?.name ?? '?',
              lastMessageTimestamp: chat.lastMessageTimestamp,
              unreadCount: chat.unreadCount,
            };
          }),
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async getState() {
      try {
        const identityRes = await this.getIdentity();
        const contactsRes = await this.getContacts();
        const chatsRes = await this.getChats();
        // Diagnose 2026-08-14: rohen IDB-User lesen, um zu sehen, ob
        // i2pSamDestination fehlt (Share-Banner "Export nicht möglich").
        let rawUser: Record<string, unknown> | null = null;
        try {
          const db = await openRawIdb();
          const all = (await idbGetAll(db, 'user')) as Array<Record<string, unknown>>;
          if (all.length > 0) {
            const u = all[0];
            const dest = (u.i2pSamDestination as string | undefined) ?? '';
            rawUser = {
              id: u.id,
              username: u.username,
              hasI2pSamDestination: !!u.i2pSamDestination,
              i2pSamDestinationLen: dest.length,
              i2pSamDestinationPrefix: dest.slice(0, 40),
              i2pSamDestinationSuffix: dest.slice(-20),
              hasI2pAddress: !!u.i2pAddress,
              i2pAddress: u.i2pAddress ?? null,
              hasI2pPublicKey: !!u.i2pPublicKey,
              hasI2pPrivateKey: !!u.i2pPrivateKey,
              hasPgpPublicKey: !!u.pgpPublicKey,
              hasPgpPrivateKey: !!u.pgpPrivateKey,
              createdAt: u.createdAt,
            };
          }
        } catch { /* Diagnose-Feld ist optional */ }
        // Diagnose 2026-08-14: i2pService.exportIdentity() zeigt, ob das
        // Live-Objekt eine samDestination hat (auch wenn storageService sie
        // nicht persistiert hat).
        let i2pServiceIdentity: Record<string, unknown> | null = null;
        try {
           
          const dbg = (window as unknown as { __i2pDebug?: { exportIdentity?: () => unknown } }).__i2pDebug;
          if (dbg?.exportIdentity) {
            const e = dbg.exportIdentity() as Record<string, unknown>;
            i2pServiceIdentity = {
              hasPublicKey: !!e.publicKey,
              publicKeyLen: (e.publicKey as string | undefined)?.length ?? 0,
              hasPrivateKey: !!e.privateKey,
              privateKeyLen: (e.privateKey as string | undefined)?.length ?? 0,
              b32Address: e.b32Address ?? null,
              hasSamDestination: !!e.samDestination,
              samDestinationLen: (e.samDestination as string | undefined)?.length ?? 0,
              samDestinationPrefix: (e.samDestination as string | undefined)?.slice(0, 40) ?? '',
            };
          }
        } catch { /* Diagnose-Feld ist optional */ }
        return {
          ok: true,
          result: {
            i2pStatus: 'connected', // TODO: aus AppContext lesen
            contacts: contactsRes.result ?? [],
            chats: chatsRes.result ?? [],
            identity: identityRes.result ?? null,
            rawUser,
            i2pServiceIdentity,
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async exportContact() {
      try {
        const user = await storageService.getUser();
        if (!user) return { ok: false, error: 'no user' };

        const content = JSON.stringify(
          {
            v: '2',
            t: 'sc',
            n: user.username,
            i: user.i2pAddress,
            f: user.fingerprint,
            k: user.pgpPublicKey,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        );

        const filename = `secuchat-contact-${user.username.replace(/\s+/g, '-')}.secuchat`;
        // Im Test-Modus geben wir den Content direkt zurück, ohne ihn auf die
        // Disk zu schreiben — der Caller (CLI-Wrapper / Skill) reicht den
        // String direkt an das andere Gerät weiter. Auf Downloads/ zu
        // schreiben würde WRITE_EXTERNAL_STORAGE brauchen, das im Test-Mode
        // nicht angefordert wird.
        return {
          ok: true,
          result: {
            filename,
            path: `inline://${filename}`,
            content,
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async importContact(body) {
      try {
        const payload = typeof body === 'string' ? JSON.parse(body) : body;
        const name = payload.n ?? payload.name;
        const i2pAddress = payload.i ?? payload.i2pAddress;
        const fingerprint = payload.f ?? payload.fingerprint;
        const pgpPublicKey = payload.k ?? payload.pgpPublicKey;

        if (!name || !i2pAddress || !fingerprint) {
          return { ok: false, error: 'missing required fields (n, i, f)' };
        }

        // Optional: PGP-Key validieren
        const validatedKey = pgpPublicKey;
        if (pgpPublicKey) {
          const v = await cryptoService.validatePublicKey(pgpPublicKey);
          if (!v.valid) {
            return { ok: false, error: `invalid PGP key: ${v.error ?? 'unknown'}` };
          }
        }

        // Dedup-Check per Fingerprint
        const existing = await storageService.getContactByFingerprint(fingerprint);
        if (existing) {
          return { ok: true, result: { contactId: existing.id } };
        }

        const contact = {
          id: crypto.randomUUID(),
          name,
          pgpPublicKey: validatedKey ?? '',
          fingerprint,
          p2pIdentifier: i2pAddress,
          i2pAddress,
          status: 'unknown' as const,
          lastSeen: new Date().toISOString(),
        };
        await storageService.saveContact(contact);
        return { ok: true, result: { contactId: contact.id } };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async createChat(body) {
      try {
        const payload = typeof body === 'string' ? JSON.parse(body) : body;
        const contact = await storageService.getContact(payload.contactId);
        if (!contact) return { ok: false, error: 'contact not found' };

        const existing = await storageService.getChatByContactId(contact.id);
        if (existing) return { ok: true, result: { chatId: existing.id } };

        const newChat = {
          id: crypto.randomUUID(),
          contactId: contact.id,
          contact,
          unreadCount: 0,
        };
        await storageService.saveChat(newChat);
        return { ok: true, result: { chatId: newChat.id } };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async sendMessage(body) {
      try {
        const payload = typeof body === 'string' ? JSON.parse(body) : body;
        const contact = await storageService.getContact(payload.contactId);
        if (!contact) return { ok: false, error: 'contact not found' };

        // The receiver (AppContext.handleIncomingMessage) only accepts
        // messages with `type: 'chat-message'` and a PGP-encrypted
        // `encryptedContent` field — anything else is silently dropped.
        // We therefore mirror the real UI send-path: PGP-encrypt with
        // the contact's public key, build a `chat-message` envelope with
        // senderId/senderFingerprint/sequenceNumber, and send through
        // i2pService. This is what AppContext.sendMessage does internally;
        // duplicating it here keeps the bridge free of UI-coupling.
        const user = await storageService.getUser();
        if (!user) return { ok: false, error: 'no user' };
        if (!contact.pgpPublicKey) {
          return { ok: false, error: 'contact has no PGP key — re-import contact' };
        }

        const chat = await storageService.getChatByContactId(contact.id);
        if (!chat) return { ok: false, error: 'no chat for contact — create-chat first' };

        const sequenceNumber = (await storageService.getLastMessageSequence(chat.id)) + 1;
        const messageId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const { cryptoService } = await import('./crypto');
        const encryptedContent = await cryptoService.encryptMessage(
          payload.text,
          contact.pgpPublicKey,
        );

        const i2pMessage = {
          type: 'chat-message',
          id: messageId,
          chatId: chat.id,
          senderId: user.id,
          senderFingerprint: user.fingerprint,
          encryptedContent,
          timestamp,
          sequenceNumber,
        };

        const { i2pService } = await import('./i2p');
        const sent = await i2pService.sendMessage(
          contact.i2pAddress,
          i2pMessage as unknown as Parameters<typeof i2pService.sendMessage>[1],
        );

        // Persist locally so the sender's UI also shows the message
        const localMessage = {
          id: messageId,
          chatId: chat.id,
          senderId: user.id,
          recipientId: contact.id,
          encryptedContent,
          decryptedContent: payload.text,
          timestamp,
          sequenceNumber,
          status: sent ? 'sent' as const : 'failed' as const,
          type: 'text' as const,
        };
        await storageService.saveMessage(localMessage);

        // Update chat lastMessageTimestamp
        await storageService.saveChat({
          ...chat,
          lastMessageTimestamp: timestamp,
        });

        return {
          ok: sent,
          result: { messageId, sent },
          ...(sent ? {} : { error: 'i2pService.sendMessage returned false' }),
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async deleteContact(body) {
      try {
        const payload = typeof body === 'string' ? JSON.parse(body) : body;
        if (!payload.contactId) return { ok: false, error: 'contactId required' };
        await storageService.deleteContact(payload.contactId);
        return { ok: true, result: { deleted: true } };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async unlock(body) {
      try {
        if (!isTestMode()) return { ok: false, error: 'unlock only available in test mode' };
        const payload = typeof body === 'string' ? JSON.parse(body) : body;
        if (!payload.passphrase) return { ok: false, error: 'passphrase required' };
        // Setze die Passphrase im Storage — der nächste AppContext-Reload
        // versucht damit zu entschlüsseln. Wir liefern sofort zurück; der
        // Caller muss die App neu laden, damit AppContext die Passphrase
        // beim Mount aufnimmt.
        storageService.setEncryptionPassphrase(payload.passphrase);
        // Diagnose: getUser erneut aufrufen und den entschlüsselten Key-Prefix zurückgeben.
        // So sehen wir, ob die Passphrase wirklich stimmt.
        const decrypted = await storageService.getUser();
        return {
          ok: true,
          result: {
            unlocked: true,
            decryptOk: !!decrypted?.pgpPrivateKey?.startsWith('-----BEGIN PGP'),
            decryptedPrefix: decrypted?.pgpPrivateKey?.slice(0, 40),
            decryptedLen: decrypted?.pgpPrivateKey?.length,
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async enableTestMode() {
      try {
        localStorage.setItem('secuchat_test_mode', '1');
        const secret = localStorage.getItem('secuchat_test_pw') ?? TEST_PASSPHRASE;
        localStorage.setItem('secuchat_test_pw', secret);
        // Native Server starten
        try {
          await DevBridgeNative.setEnabled({ enabled: true });
        } catch (e) {
          return { ok: false, error: 'native enable failed: ' + errorMessage(e) };
        }
        return { ok: true, result: { enabled: true } };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async triggerAutoOnboard(opts) {
      try {
        if (!isTestMode()) return { ok: false, error: 'test mode not enabled — call enableTestMode first' };
        // opts kommt vom Java-Bridge als String (jsString(body)). Wrapper
        // kann entweder einen bloßen host-String ('127.0.0.1') oder einen
        // JSON-Objekt-String ('{"username":"a50",...}') uebergeben. Wenn
        // JSON: parsen statt als host zu interpretieren.
        let params: Record<string, unknown>;
        if (typeof opts === 'string') {
          const trimmed = opts.trim();
          if (trimmed.startsWith('{')) {
            try { params = JSON.parse(trimmed) as Record<string, unknown>; }
            catch { params = { host: opts }; }
          } else {
            params = { host: opts };
          }
        } else {
          params = opts ?? {};
        }
        // Reihenfolge ist wichtig: erst username/deviceName/host setzen,
        // dann secuchat_auto_onboard='1'. Das Onboarding-Polling (500 ms) liest
        // beim ersten '1' alle Keys und nimmt den Default 'Android', wenn
        // username noch nicht gesetzt war. Daher alles VOR dem Trigger-Flag.
        const host = typeof params.host === 'string' ? params.host : '';
        if (host) localStorage.setItem('secuchat_auto_onboard_host', host);
        const username = typeof params.username === 'string' ? params.username : '';
        const deviceName = typeof params.deviceName === 'string' ? params.deviceName : '';
        if (username) localStorage.setItem('secuchat_auto_onboard_username', username);
        if (deviceName) localStorage.setItem('secuchat_auto_onboard_device', deviceName);
        localStorage.setItem('secuchat_auto_onboard', '1');
        // Debug: verifiziere dass die Keys wirklich da sind
         
        console.log('[TRIGGER-AUTO-ONBOARD] keys after setItem:', JSON.stringify({
          username: localStorage.getItem('secuchat_auto_onboard_username'),
          device: localStorage.getItem('secuchat_auto_onboard_device'),
          flag: localStorage.getItem('secuchat_auto_onboard'),
          host: localStorage.getItem('secuchat_auto_onboard_host'),
        }));
        // KEIN window.location.reload(): Das killt den WebView in Capacitor.
        // Onboarding.tsx pollt alle 500ms nach 'secuchat_auto_onboard'==='1'
        // und fuehrt Auto-Onboarding dann aus.
        return { ok: true, result: { triggered: true } };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async debugState() {
      try {
        const testMode = localStorage.getItem('secuchat_test_mode');
        const testPw = localStorage.getItem('secuchat_test_pw');
        const user = await storageService.getUser();
        const pk = user?.pgpPrivateKey ?? '';
        return {
          ok: true,
          result: {
            testMode,
            testPw,
            pgpPrivateKeyPrefix: pk.slice(0, 30),
            pgpPrivateKeyLen: pk.length,
            pgpPrivateKeyFull: pk,
            isTestModeViaImport: typeof localStorage !== 'undefined' && localStorage.getItem('secuchat_test_mode') === '1',
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async tryDecryptRealistic() {
      try {
        // Realistic-Test: openpgp.generateKey() → encryptData → decryptData
        // mit TEST_PASSPHRASE. Repräsentiert genau den Onboarding-Pfad.
        const encModule = await import('./storage/browser/encryption');
        const passphrase = 'testpass123';
        // Simulierter PGP-Key-Plaintext (~2 KB, mit Newlines wie echter OpenPGP-Output)
        const simulatedPlaintext = '-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n' + 'x'.repeat(2000) + '\n-----END PGP PRIVATE KEY BLOCK-----';
        const ct = await encModule.encryptData(simulatedPlaintext, passphrase);
        let dec = null;
        let err = null;
        try { dec = await encModule.decryptData(ct, passphrase); }
        catch (e) { err = String(e).slice(0, 100); }
        return {
          ok: true,
          result: {
            passphrase,
            plainLen: simulatedPlaintext.length,
            ctLen: ct.length,
            decOk: dec === simulatedPlaintext,
            decLen: dec?.length ?? null,
            decStart: dec?.slice(0, 30) ?? null,
            err,
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async tryDecryptIdb() {
      try {
        // Liest den ersten User aus IDB, dump't das volle pgpPrivateKey-Feld.
        // So sehen wir den exakten ciphertext den saveUser geschrieben hat.
        const db = await openRawIdb();
        const users = await idbGetAll(db, 'user');
        if (users.length === 0) return { ok: false, error: 'no user in IDB' };
        const u = users[0] as { id?: string; pgpPrivateKey?: string };
        return {
          ok: true,
          result: {
            userId: u.id,
            pkFull: u.pgpPrivateKey,
            pkLen: u.pgpPrivateKey?.length ?? 0,
            pkIsBase64: /^[A-Za-z0-9+/=]+$/.test((u.pgpPrivateKey ?? '').replace(/^v2:/, '')),
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async tryDecryptSelf() {
      try {
        // Self-Test: encryptData → decryptData mit TEST_PASSPHRASE.
        // Wenn symmetrisch, liefert dec wieder 'HELLO-PGP-PLAINTEXT'.
        const encModule = await import('./storage/browser/encryption');
        const passphrase = 'testpass123';
        const plaintext = 'HELLO-PGP-PLAINTEXT';
        const ct = await encModule.encryptData(plaintext, passphrase);
        let dec = null;
        let err = null;
        try { dec = await encModule.decryptData(ct, passphrase); }
        catch (e) { err = String(e).slice(0, 100); }
        return {
          ok: true,
          result: {
            passphrase,
            ctPrefix: ct.slice(0, 40),
            ctLen: ct.length,
            decOk: dec === plaintext,
            dec,
            err,
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async tryDecrypt() {
      try {
        // Direkter Decrypt-Test: Welche Passphrase entschlüsselt den User-Key wirklich?
        // Liest raw aus IDB und versucht decryptData() — fängt Fehler ab.
        const db = await openRawIdb();
        const users = await idbGetAll(db, 'user');
        if (users.length === 0) return { ok: false, error: 'no user in IDB' };
        const u = users[0] as { id?: string; pgpPrivateKey?: string; pgpPublicKey?: string };
        if (!u.pgpPrivateKey) return { ok: false, error: 'user has no pgpPrivateKey' };
        const enc = u.pgpPrivateKey;
        const hasV2Prefix = enc.startsWith('v2:');
        const raw = hasV2Prefix ? enc.slice(3) : enc;
        const encModule = await import('./storage/browser/encryption');
        // Direkter crypto.subtle.decrypt-Test mit den exakten Bytes.
        // Das ist der innerste Call von decryptData(). Wenn AES-GCM hier wirft,
        // dann liegt das Problem in unserem Code. Wenn nicht, dann kommt der
        // 1471-byte String von crypto.subtle selbst.
        let directResult: { ok: boolean; len?: number; prefix?: string; err?: string } = { ok: false };
        try {
          const combined = new Uint8Array(atob(raw).split('').map((c: string) => c.charCodeAt(0)));
          const salt = combined.slice(0, 16);
          const iv = combined.slice(16, 28);
          const ciphertext = combined.slice(28);
          const enc2 = new TextEncoder().encode('testpass123');
          const km = await crypto.subtle.importKey('raw', enc2, 'PBKDF2', false, ['deriveKey']);
          const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
            km,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt'],
          );
          const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
          const decStr = new TextDecoder().decode(dec);
          directResult = { ok: decStr.startsWith('-----BEGIN PGP'), len: decStr.length, prefix: decStr.slice(0, 30) };
        } catch (e) {
          directResult = { ok: false, err: String(e).slice(0, 100) };
        }
        // Auch via decryptData() testen
        const results: Array<{ passphrase: string; ok: boolean; prefix?: string; len?: number; err?: string }> = [];
        const candidates = ['testpass123', 'test', 'password', ''];
        for (const pp of candidates) {
          try {
            const dec = await encModule.decryptData(raw, pp);
            results.push({ passphrase: pp, ok: dec.startsWith('-----BEGIN PGP'), prefix: dec.slice(0, 40), len: dec.length });
          } catch (e) {
            results.push({ passphrase: pp, ok: false, err: String(e).slice(0, 80) });
          }
        }
        return {
          ok: true,
          result: {
            userId: u.id,
            rawLen: raw.length,
            hasV2Prefix,
            directAesGcm: directResult,
            viaDecryptData: results,
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async listAllUsers() {
      try {
        // Direkter Zugriff auf IndexedDB — umgeht storageService und seine Auto-Decrypt-Logik.
        const db = await openRawIdb();
        const users = await idbGetAll(db, 'user');
        return {
          ok: true,
          result: {
            count: users.length,
            users: users.map((u) => {
              const rec = u as { id?: string; pgpPrivateKey?: string; i2pAddress?: string };
              return {
                id: rec.id ?? '?',
                pkLen: rec.pgpPrivateKey?.length ?? 0,
                i2pAddr: rec.i2pAddress,
              };
            }),
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async clearAllUsers() {
      try {
        const db = await openRawIdb();
        const tx = db.transaction(['user'], 'readwrite');
        const store = tx.objectStore('user');
        await new Promise<void>((resolve, reject) => {
          const req = store.clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        return { ok: true, result: { deleted: 0 } };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async appDebugState() {
      try {
        const w = window as unknown as {
          __secuchatAppDebug?: () => {
            chatsCount: number;
            contactsCount: number;
            chatsFirst: { id: string; contactId: string; hasContactField: boolean; contactName?: string } | null;
            contactsFirst: { id: string; name: string } | null;
            isLocked: boolean;
            isAuthenticated: boolean;
          };
        };
        const debug = w.__secuchatAppDebug?.();
        if (!debug) {
          return { ok: false, error: 'appDebug not available (test_mode not active?)' };
        }
        return { ok: true, result: debug };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },

    async clearStaleContacts() {
      try {
        // Snapshot aller Kontakte + Chats (storageService = mit Auto-Decrypt).
        const contacts = await storageService.getAllContacts();
        const chats = await storageService.getAllChats();

        let removedDuplicates = 0;
        let removedOrphanChats = 0;
        let removedBrokenContacts = 0;

        // 1. Shadow-Kontakte deduplizieren (gleiche i2pAddress).
        const byAddr = new Map<string, typeof contacts>();
        for (const c of contacts) {
          if (!c.i2pAddress) continue;
          const arr = byAddr.get(c.i2pAddress) ?? [];
          arr.push(c);
          byAddr.set(c.i2pAddress, arr);
        }
        for (const dupes of byAddr.values()) {
          if (dupes.length <= 1) continue;
          // Winner: aktuellster lastSeen (Fallback: erster Eintrag).
          dupes.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
          const winner = dupes[0];
          for (let i = 1; i < dupes.length; i++) {
            const loser = dupes[i];
            // Cascade: alle Chats dieses Kontakts + deren Messages löschen.
            for (const chat of chats.filter((ch) => ch.contactId === loser.id)) {
              await storageService.deleteMessagesByChat(chat.id);
              await storageService.deleteChat(chat.id);
            }
            await storageService.deleteContact(loser.id);
            removedDuplicates++;
          }
          // Falls der Winner selbst KEINEN Chat hat, aber einer der Loser
          // schon: hängen wir nichts um (v3 hat unique constraint — das
          // geht gar nicht mehr). Stattdessen Hinweis im Log.
          if (!chats.some((ch) => ch.contactId === winner.id)) {
            console.warn(
              '[DevBridge] clearStaleContacts: winner contact',
              winner.id,
              'has no chat; orphaned chat from a loser will be lost (v3 unique constraint).',
            );
          }
        }

        // 2. Kaputte Kontakte (name === '?' und kein PGP-Key) entfernen.
        const liveContactIds = new Set(
          (await storageService.getAllContacts()).map((c) => c.id),
        );
        const brokenContacts = contacts.filter(
          (c) => c.name === '?' && !c.pgpPublicKey && liveContactIds.has(c.id),
        );
        for (const c of brokenContacts) {
          for (const chat of chats.filter((ch) => ch.contactId === c.id)) {
            await storageService.deleteMessagesByChat(chat.id);
            await storageService.deleteChat(chat.id);
          }
          await storageService.deleteContact(c.id);
          removedBrokenContacts++;
        }

        // 3. Orphan-Chats: contactId existiert nicht mehr.
        const finalContactIds = new Set(
          (await storageService.getAllContacts()).map((c) => c.id),
        );
        const finalChats = await storageService.getAllChats();
        for (const chat of finalChats) {
          if (!finalContactIds.has(chat.contactId)) {
            await storageService.deleteMessagesByChat(chat.id);
            await storageService.deleteChat(chat.id);
            removedOrphanChats++;
          }
        }

        // 4. Final-Stand für Caller-Verifikation.
        const remainingContacts = (await storageService.getAllContacts()).length;
        const remainingChats = (await storageService.getAllChats()).length;

        return {
          ok: true,
          result: {
            scannedContacts: contacts.length,
            removedDuplicates,
            removedOrphanChats,
            removedBrokenContacts,
            remainingContacts,
            remainingChats,
          },
        };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    },
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Direkter Zugriff auf die SecuChat-IndexedDB ohne storageService-Wrapper.
 * Wird nur für Diagnose-Endpunkte benutzt (listAllUsers, clearAllUsers) — der
 * normale Datenpfad läuft weiter über storageService.
 */
const SECUCHAT_DB_NAME = 'SecureChatDB';
const SECUCHAT_DB_VERSION = 3;

function openRawIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SECUCHAT_DB_NAME, SECUCHAT_DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IDB open blocked'));
  });
}

function idbGetAll(db: IDBDatabase, storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}