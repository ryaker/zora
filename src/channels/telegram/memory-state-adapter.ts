/**
 * MemoryStateAdapter — In-process StateAdapter for the Vercel chat SDK.
 *
 * Implements locking, subscriptions, and key-value caching in-memory.
 * Suitable for single-process deployments (polling mode). For multi-process
 * or serverless deployments, replace with a Redis-backed implementation.
 */

import { type StateAdapter, type Lock } from 'chat';
import { randomUUID } from 'crypto';

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

export class MemoryStateAdapter implements StateAdapter {
  private readonly _cache = new Map<string, CacheEntry<unknown>>();
  private readonly _subscriptions = new Set<string>();
  private readonly _locks = new Map<string, Lock>();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this._cache.clear();
    this._subscriptions.clear();
    this._locks.clear();
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this._cache.set(key, {
      value,
      expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : undefined,
    });
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    // Synchronous check-and-set: operates directly on _cache without intermediate
    // await points so concurrent callers cannot interleave between the check and the set.
    const existing = this._cache.get(key);
    if (existing !== undefined) {
      if (existing.expiresAt === undefined || Date.now() < existing.expiresAt) {
        return false; // Key exists and has not expired
      }
      // Entry has expired — fall through to overwrite
    }
    this._cache.set(key, {
      value,
      expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : undefined,
    });
    return true;
  }

  async delete(key: string): Promise<void> {
    this._cache.delete(key);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    return this._subscriptions.has(threadId);
  }

  async subscribe(threadId: string): Promise<void> {
    this._subscriptions.add(threadId);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this._subscriptions.delete(threadId);
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const existing = this._locks.get(threadId);
    if (existing && Date.now() < existing.expiresAt) {
      return null; // Already locked
    }
    const lock: Lock = {
      threadId,
      token: randomUUID(),
      expiresAt: Date.now() + ttlMs,
    };
    this._locks.set(threadId, lock);
    return lock;
  }

  async releaseLock(lock: Lock): Promise<void> {
    const existing = this._locks.get(lock.threadId);
    if (existing?.token === lock.token) {
      this._locks.delete(lock.threadId);
    }
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const existing = this._locks.get(lock.threadId);
    if (!existing || existing.token !== lock.token) return false;
    existing.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this._locks.delete(threadId);
  }
}

export function createMemoryState(): MemoryStateAdapter {
  return new MemoryStateAdapter();
}
