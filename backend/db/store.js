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
    inventory  TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS world_flags (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS npc_memory (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    npc_id     TEXT NOT NULL,
    player_id  INTEGER NOT NULL,
    role       TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- переопределённые персоны агентов: правка из панели живёт отдельно от content/**
  CREATE TABLE IF NOT EXISTS npc_persona (
    npc_id     TEXT PRIMARY KEY,
    text       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

export class Store {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.migrate();

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
      loadState: this.db.prepare('SELECT x, z, yaw, inventory FROM state WHERE player_id = ?'),
      getFlag: this.db.prepare('SELECT value FROM world_flags WHERE key = ?'),
      allFlags: this.db.prepare('SELECT key, value FROM world_flags'),
      getPersona: this.db.prepare('SELECT text FROM npc_persona WHERE npc_id = ?'),
      allPersonas: this.db.prepare('SELECT npc_id, text, updated_at FROM npc_persona ORDER BY npc_id'),
      setPersona: this.db.prepare(
        `INSERT INTO npc_persona (npc_id, text, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(npc_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
      ),
      resetPersona: this.db.prepare('DELETE FROM npc_persona WHERE npc_id = ?'),
      setFlag: this.db.prepare(
        `INSERT INTO world_flags (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ),
      addMemory: this.db.prepare(
        'INSERT INTO npc_memory (npc_id, player_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)',
      ),
      recentMemory: this.db.prepare(
        'SELECT role, text FROM npc_memory WHERE npc_id = ? AND player_id = ? ORDER BY id DESC LIMIT ?',
      ),
      clearNpcMemory: this.db.prepare('DELETE FROM npc_memory'),
      saveState: this.db.prepare(
        `INSERT INTO state (player_id, x, z, yaw, inventory, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET x = excluded.x, z = excluded.z,
           yaw = excluded.yaw, inventory = excluded.inventory, updated_at = excluded.updated_at`,
      ),
    };
  }

  /**
   * Догоняющая миграция: база с прошлой вехи уже существует, и пересоздавать
   * её на демо нельзя — там прогресс игроков. Добавляем недостающие колонки.
   */
  migrate() {
    const columns = this.db.prepare('PRAGMA table_info(state)').all().map((c) => c.name);
    if (!columns.includes('inventory')) {
      this.db.exec("ALTER TABLE state ADD COLUMN inventory TEXT NOT NULL DEFAULT '[]'");
    }
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

  saveState(playerId, x, z, yaw, inventory) {
    this.q.saveState.run(playerId, x, z, yaw, JSON.stringify(inventory ?? []), Date.now());
  }

  getFlag(key) {
    return this.q.getFlag.get(key)?.value ?? null;
  }

  /** Все флаги мира: позднему игроку нужны не только заранее перечисленные. */
  allFlags() {
    return this.q.allFlags.all();
  }

  /**
   * Все переопределённые персоны разом: [{ id, text, updatedAt }].
   * Панель F3 отдаёт их списком, а не по одному запросу на агента.
   */
  getPersonas() {
    return this.q.allPersonas.all().map((row) => ({
      id: row.npc_id,
      text: row.text,
      updatedAt: Number(row.updated_at),
    }));
  }

  /** Переопределённая персона агента: null — берём из content/npcs.json. */
  getPersona(npcId) {
    return this.q.getPersona.get(String(npcId))?.text ?? null;
  }

  setPersona(npcId, text) {
    this.q.setPersona.run(String(npcId), String(text), Date.now());
  }

  /** Сброс на персону из файла: строки в базе больше нет. */
  resetPersona(npcId) {
    this.q.resetPersona.run(String(npcId));
  }

  /** Старое имя resetPersona: обработчик админки в index.js зовёт его. */
  clearPersona(npcId) {
    this.resetPersona(npcId);
  }

  setFlag(key, value) {
    this.q.setFlag.run(key, String(value));
  }

  addMemory(npcId, playerId, role, text) {
    this.q.addMemory.run(npcId, playerId, role, String(text).slice(0, 600), Date.now());
  }

  /** Последние реплики в хронологическом порядке — их и отдаём модели. */
  recentMemory(npcId, playerId, limit = 12) {
    return this.q.recentMemory.all(npcId, playerId, limit).reverse();
  }

  clearNpcMemory() {
    this.q.clearNpcMemory.run();
  }

  close() {
    this.db.close();
  }
}
