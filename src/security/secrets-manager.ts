/**
 * SecretsManager — AES-256-GCM encrypted secrets storage.
 *
 * Spec §5.5 "Secrets Management (IronClaw JIT Pattern)":
 *   - Secrets are encrypted at rest with AES-256-GCM
 *   - JIT decryption: decrypt → return → immediately dereference
 *   - Master key derived via PBKDF2 (production would use macOS Keychain via keytar)
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SecretReference } from './security-types.js';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

interface SecretsStore {
  secrets: SecretReference[];
}

export class SecretsManager {
  private readonly _configDir: string;
  private readonly _secretsPath: string;
  private readonly _masterPassword: string;

  /**
   * @param configDir  Path to the config directory (e.g. ~/.zora)
   * @param masterPassword  Master password for key derivation.
   *   NOTE: In production this would come from macOS Keychain via `keytar`.
   *   Using a password parameter here to avoid requiring native compilation.
   */
  constructor(configDir: string, masterPassword = 'zora-default-master-key') {
    this._configDir = configDir;
    this._secretsPath = path.join(configDir, 'secrets.enc');
    this._masterPassword = masterPassword;
  }

  /**
   * Initialize the secrets store. Creates secrets.enc if it does not exist.
   */
  async init(): Promise<void> {
    await fs.mkdir(this._configDir, { recursive: true });

    try {
      await fs.access(this._secretsPath);
    } catch {
      const empty: SecretsStore = { secrets: [] };
      await fs.writeFile(this._secretsPath, JSON.stringify(empty), 'utf-8');
    }
  }

  /**
   * Store a secret. Encrypts with AES-256-GCM using a per-entry salt and IV.
   */
  async storeSecret(name: string, value: string): Promise<void> {
    const store = await this._readStore();

    // Remove existing entry with same name
    store.secrets = store.secrets.filter(s => s.name !== name);

    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = this._deriveKey(salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    let encrypted = cipher.update(value, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    store.secrets.push({
      name,
      encryptedValue: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      salt: salt.toString('hex'),
    });

    await this._writeStore(store);
  }

  /**
   * Retrieve a secret using JIT decryption.
   * The decrypted value is returned but never stored on `this`.
   */
  async getSecret(name: string): Promise<string | null> {
    const store = await this._readStore();
    const entry = store.secrets.find(s => s.name === name);
    if (!entry) return null;

    const salt = Buffer.from(entry.salt, 'hex');
    const key = this._deriveKey(salt);
    const iv = Buffer.from(entry.iv, 'hex');
    const authTag = Buffer.from(entry.authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(entry.encryptedValue, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    // JIT: value is returned directly, never stored on instance
    return decrypted;
  }

  /**
   * Delete a secret by name.
   */
  async deleteSecret(name: string): Promise<boolean> {
    const store = await this._readStore();
    const before = store.secrets.length;
    store.secrets = store.secrets.filter(s => s.name !== name);
    if (store.secrets.length === before) return false;
    await this._writeStore(store);
    return true;
  }

  /**
   * List stored secret names (never values).
   */
  async listSecretNames(): Promise<string[]> {
    const store = await this._readStore();
    return store.secrets.map(s => s.name);
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private _deriveKey(salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      this._masterPassword,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha256',
    );
  }

  private async _readStore(): Promise<SecretsStore> {
    const data = await fs.readFile(this._secretsPath, 'utf-8');
    return JSON.parse(data) as SecretsStore;
  }

  private async _writeStore(store: SecretsStore): Promise<void> {
    await fs.writeFile(this._secretsPath, JSON.stringify(store, null, 2), 'utf-8');
  }
}
