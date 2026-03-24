/**
 * Session Store
 *
 * Persistent storage for session metadata using SQLite.
 * Survives process restarts so sessions can be resumed.
 */

import Database from "better-sqlite3";
import { resolve } from "path";

export class SessionStore {
  constructor(dataDir) {
    const dbPath = resolve(dataDir, "sessions.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        context_key TEXT PRIMARY KEY,
        resume_session_id TEXT,
        workdir TEXT,
        last_activity INTEGER,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `);

    this._stmtGet = this.db.prepare(
      "SELECT * FROM sessions WHERE context_key = ?"
    );
    this._stmtSet = this.db.prepare(`
      INSERT INTO sessions (context_key, resume_session_id, workdir, last_activity, updated_at)
      VALUES (@contextKey, @resumeSessionId, @workdir, @lastActivity, unixepoch())
      ON CONFLICT(context_key) DO UPDATE SET
        resume_session_id = @resumeSessionId,
        workdir = @workdir,
        last_activity = @lastActivity,
        updated_at = unixepoch()
    `);
    this._stmtDelete = this.db.prepare(
      "DELETE FROM sessions WHERE context_key = ?"
    );
    this._stmtAll = this.db.prepare(
      "SELECT * FROM sessions ORDER BY last_activity DESC"
    );
  }

  get(contextKey) {
    const row = this._stmtGet.get(contextKey);
    if (!row) return null;
    return {
      resumeSessionId: row.resume_session_id,
      workdir: row.workdir,
      lastActivity: row.last_activity,
    };
  }

  set(contextKey, data) {
    this._stmtSet.run({
      contextKey,
      resumeSessionId: data.resumeSessionId || null,
      workdir: data.workdir || null,
      lastActivity: data.lastActivity || Date.now(),
    });
  }

  delete(contextKey) {
    this._stmtDelete.run(contextKey);
  }

  all() {
    return this._stmtAll.all();
  }

  close() {
    this.db.close();
  }
}
