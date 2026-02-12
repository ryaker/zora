import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecretsManager } from '../../../src/security/secrets-manager.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

describe('SecretsManager', () => {
  let tmpDir: string;
  let manager: SecretsManager;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `zora-secrets-test-${crypto.randomUUID()}`);
    manager = new SecretsManager(tmpDir, 'test-master-password');
    await manager.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates secrets.enc on init', async () => {
    const exists = await fs.access(path.join(tmpDir, 'secrets.enc')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('does not overwrite secrets.enc on re-init', async () => {
    await manager.storeSecret('key1', 'value1');
    await manager.init(); // re-init
    const names = await manager.listSecretNames();
    expect(names).toContain('key1');
  });

  it('encrypts and decrypts a secret (roundtrip)', async () => {
    await manager.storeSecret('api-key', 'sk-test-12345');
    const value = await manager.getSecret('api-key');
    expect(value).toBe('sk-test-12345');
  });

  it('returns null for non-existent secrets', async () => {
    const value = await manager.getSecret('does-not-exist');
    expect(value).toBeNull();
  });

  it('overwrites existing secret with same name', async () => {
    await manager.storeSecret('token', 'old-value');
    await manager.storeSecret('token', 'new-value');
    const value = await manager.getSecret('token');
    expect(value).toBe('new-value');
    const names = await manager.listSecretNames();
    expect(names.filter(n => n === 'token')).toHaveLength(1);
  });

  it('lists stored secret names without values', async () => {
    await manager.storeSecret('key-a', 'val-a');
    await manager.storeSecret('key-b', 'val-b');
    const names = await manager.listSecretNames();
    expect(names).toEqual(expect.arrayContaining(['key-a', 'key-b']));
    expect(names).toHaveLength(2);
  });

  it('deletes a secret', async () => {
    await manager.storeSecret('temp', 'ephemeral');
    const deleted = await manager.deleteSecret('temp');
    expect(deleted).toBe(true);
    const value = await manager.getSecret('temp');
    expect(value).toBeNull();
  });

  it('returns false when deleting non-existent secret', async () => {
    const deleted = await manager.deleteSecret('ghost');
    expect(deleted).toBe(false);
  });

  it('JIT pattern: decrypted value is not stored on instance', async () => {
    await manager.storeSecret('jit-test', 'sensitive-data');
    await manager.getSecret('jit-test');

    // The instance should NOT have any property containing the decrypted value
    const instanceJson = JSON.stringify(manager);
    expect(instanceJson).not.toContain('sensitive-data');
  });

  it('uses unique salt and IV per entry', async () => {
    await manager.storeSecret('secret-1', 'same-value');
    await manager.storeSecret('secret-2', 'same-value');

    const data = JSON.parse(await fs.readFile(path.join(tmpDir, 'secrets.enc'), 'utf-8'));
    const s1 = data.secrets.find((s: any) => s.name === 'secret-1');
    const s2 = data.secrets.find((s: any) => s.name === 'secret-2');

    expect(s1.salt).not.toBe(s2.salt);
    expect(s1.iv).not.toBe(s2.iv);
    expect(s1.encryptedValue).not.toBe(s2.encryptedValue);
  });
});
