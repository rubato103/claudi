/**
 * Session Store
 *
 * Persistent storage for session metadata using a JSON file.
 * No native dependencies — works on any platform.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

export class SessionStore {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = resolve(dataDir, "sessions.json");
    this.data = {};
    this._load();
  }

  _load() {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        this.data = JSON.parse(raw);
      }
    } catch (err) {
      console.warn("[SessionStore] Failed to load, starting fresh:", err.message);
      this.data = {};
    }
  }

  _save() {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("[SessionStore] Failed to save:", err.message);
    }
  }

  get(contextKey) {
    const row = this.data[contextKey];
    if (!row) return null;
    return {
      resumeSessionId: row.resumeSessionId,
      workdir: row.workdir,
      lastActivity: row.lastActivity,
    };
  }

  set(contextKey, data) {
    this.data[contextKey] = {
      resumeSessionId: data.resumeSessionId || null,
      workdir: data.workdir || null,
      lastActivity: data.lastActivity || Date.now(),
      updatedAt: Date.now(),
    };
    this._save();
  }

  delete(contextKey) {
    delete this.data[contextKey];
    this._save();
  }

  all() {
    return Object.entries(this.data).map(([key, val]) => ({
      context_key: key,
      ...val,
    }));
  }

  close() {
    this._save();
  }
}
