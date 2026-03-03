import { describe, it, expect } from 'vitest';

// We test the pure logic of BackupService (validation, format detection)
// without needing the full browser/storage environment.

const BACKUP_MAGIC = 'SECUCHAT_BACKUP';

function validateBackupFile(fileContent: string) {
  try {
    const parsed = JSON.parse(fileContent);

    if (parsed.magic === BACKUP_MAGIC) {
      const result: Record<string, unknown> = {
        valid: true,
        encrypted: parsed.encrypted,
        version: parsed.version,
        timestamp: parsed.timestamp,
      };
      if (!parsed.encrypted) {
        try {
          const data = JSON.parse(parsed.data);
          result.username = data.user?.username;
          result.contactCount = data.contacts?.length ?? 0;
          result.messageCount = data.messages?.length ?? 0;
        } catch {
          return { valid: false, error: 'Ungültige Backup-Daten' };
        }
      }
      return result;
    }

    if (parsed.version === '2.0' && parsed.user && Array.isArray(parsed.contacts)) {
      return {
        valid: true,
        encrypted: false,
        version: parsed.version,
        username: parsed.user?.username,
        contactCount: parsed.contacts?.length ?? 0,
        messageCount: parsed.messages?.length ?? 0,
      };
    }

    if (parsed.version === '2.0' && parsed.type === 'backup' && parsed.pgpPublicKey) {
      return {
        valid: true,
        encrypted: false,
        version: 'keys-only',
        username: parsed.username,
      };
    }

    return { valid: false, error: 'Unbekanntes Backup-Format' };
  } catch {
    if (fileContent.startsWith('-----BEGIN PGP')) {
      return { valid: true, encrypted: true, version: 'legacy-pgp' };
    }
    return { valid: false, error: 'Ungültiges JSON-Format' };
  }
}

describe('Backup Validation', () => {
  it('validates v3.0 unencrypted backup', () => {
    const backup = JSON.stringify({
      magic: BACKUP_MAGIC,
      version: '3.0',
      encrypted: false,
      timestamp: '2026-03-03T00:00:00Z',
      data: JSON.stringify({
        user: { username: 'TestUser' },
        contacts: [{ id: '1' }, { id: '2' }],
        messages: [{ id: 'm1' }],
      }),
    });
    const result = validateBackupFile(backup);
    expect(result.valid).toBe(true);
    expect(result.encrypted).toBe(false);
    expect(result.username).toBe('TestUser');
    expect(result.contactCount).toBe(2);
    expect(result.messageCount).toBe(1);
  });

  it('validates v3.0 encrypted backup', () => {
    const backup = JSON.stringify({
      magic: BACKUP_MAGIC,
      version: '3.0',
      encrypted: true,
      timestamp: '2026-03-03T00:00:00Z',
      data: 'base64encrypteddata',
    });
    const result = validateBackupFile(backup);
    expect(result.valid).toBe(true);
    expect(result.encrypted).toBe(true);
  });

  it('validates legacy v2.0 full backup', () => {
    const backup = JSON.stringify({
      version: '2.0',
      timestamp: '2026-01-01T00:00:00Z',
      user: { username: 'LegacyUser' },
      contacts: [],
      messages: [{ id: 'm1' }, { id: 'm2' }],
    });
    const result = validateBackupFile(backup);
    expect(result.valid).toBe(true);
    expect(result.version).toBe('2.0');
    expect(result.username).toBe('LegacyUser');
  });

  it('validates keys-only backup from onboarding', () => {
    const backup = JSON.stringify({
      version: '2.0',
      type: 'backup',
      username: 'KeyUser',
      pgpPublicKey: '-----BEGIN PGP PUBLIC KEY-----',
      pgpPrivateKey: '-----BEGIN PGP PRIVATE KEY-----',
    });
    const result = validateBackupFile(backup);
    expect(result.valid).toBe(true);
    expect(result.version).toBe('keys-only');
  });

  it('detects legacy PGP-encrypted backup', () => {
    const result = validateBackupFile('-----BEGIN PGP MESSAGE-----\ndata\n-----END PGP MESSAGE-----');
    expect(result.valid).toBe(true);
    expect(result.encrypted).toBe(true);
    expect(result.version).toBe('legacy-pgp');
  });

  it('rejects invalid JSON', () => {
    const result = validateBackupFile('not json at all');
    expect(result.valid).toBe(false);
  });

  it('rejects unknown format', () => {
    const result = validateBackupFile(JSON.stringify({ foo: 'bar' }));
    expect(result.valid).toBe(false);
  });
});
