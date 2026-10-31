/**
 * База: состояние игроков и сессии.
 *
 * Используем встроенный `node:sqlite` — в Node 24 он есть без флагов.
 * Это важнее, чем кажется: `better-sqlite3` пришлось бы собирать нативной
 * сборкой на каждой машине, а нам нужен запуск одной командой в офлайне.
 *
 * Файл базы — data/game.db. WAL, чтобы переживать выключение ноутбука,
 * а не только падение процесса.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    login      TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    pass_hash  TEXT NOT NULL,
    pass_salt  TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    player_id  INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS state (
    player_id  INTEGER PRIMARY KEY,
    x          REAL NOT NULL,
    z          REAL NOT NULL,
    yaw        REAL NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS world_flags (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export class Store {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);

    this.q = {
      playerByLogin: this.db.prepare('SELECT * FROM players WHERE login = ?'),
      playerById: this.db.prepare('SELECT * FROM players WHERE id = ?'),
      insertPlayer: this.db.prepare(
        'INSERT INTO players (login, name, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?)',
      ),
      insertSession: this.db.prepare(
        'INSERT INTO sessions (token_hash, player_id, expires_at) VALUES (?, ?, ?)',
      ),
      session: this.db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
      dropSession: this.db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
      dropExpired: this.db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
      loadState: this.db.prepare('SELECT x, z, yaw FROM state WHERE player_id = ?'),
      saveState: this.db.prepare(
        `INSERT INTO state (player_id, x, z, yaw, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET x = excluded.x, z = excluded.z,
           yaw = excluded.yaw, updated_at = excluded.updated_at`,
      ),
    };
  }

  playerByLogin(login) {
    return this.q.playerByLogin.get(login) ?? null;
  }

  playerById(id) {
    return this.q.playerById.get(id) ?? null;
  }

  createPlayer(login, name, hash, salt) {
    this.q.insertPlayer.run(login, name, hash, salt, Date.now());
    return this.playerByLogin(login);
  }

  createSession(tokenHash, playerId, expiresAt) {
    this.q.dropExpired.run(Date.now());
    this.q.insertSession.run(tokenHash, playerId, expiresAt);
  }

  session(tokenHash) {
    return this.q.session.get(tokenHash) ?? null;
  }

  dropSession(tokenHash) {
    this.q.dropSession.run(tokenHash);
  }

  loadState(playerId) {
    return this.q.loadState.get(playerId) ?? null;
  }

  saveState(playerId, x, z, yaw) {
    this.q.saveState.run(playerId, x, z, yaw, Date.now());
  }

  close() {
    this.db.close();
  }
}
