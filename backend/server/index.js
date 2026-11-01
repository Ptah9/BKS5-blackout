/**
 * РЎРµСЂРІРµСЂ РёРіСЂС‹: СЃС‚Р°С‚РёРєР° РєР»РёРµРЅС‚Р°, HTTP-API РІС…РѕРґР° Рё WebSocket-РјРёСЂ.
 *
 * M2: Р»РѕРіРёРЅ СЃ РїР°СЂРѕР»РµРј, С‚РѕРєРµРЅ СЃРµСЃСЃРёРё, СЃРѕСЃС‚РѕСЏРЅРёРµ РІ SQLite, СЃРЅР°РїС€РѕС‚ РїСЂРё РІС…РѕРґРµ
 * Рё РґРµР»СЊС‚С‹ РїРѕР·РёС†РёР№ 20 СЂР°Р· РІ СЃРµРєСѓРЅРґСѓ.
 *
 * Р—Р°РїСѓСЃРє:
 *   node backend/server/index.js          вЂ” https://<ip>:8443 (РµСЃР»Рё РµСЃС‚СЊ СЃРµСЂС‚РёС„РёРєР°С‚)
 *   node backend/server/index.js --dev    вЂ” http://127.0.0.1:8080 (РґР»СЏ Vite dev-СЃРµСЂРІРµСЂР°)
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { Store } from '../db/store.js';
import { hashPassword, hashToken, newToken, verifyPassword } from './auth.js';
import { AgentRuntime, probeLocal } from './agent.js';
import { Scenario } from './scenario.js';
import { START_INVENTORY, findRecipe, sanitizeInventory } from '../../shared/items.js';
import { toRussianName } from '../../shared/translit.js';
import { AUTH, CLOSE, HELLO_TIMEOUT_MS, MSG, PROTOCOL_VERSION, TICK, WORLD } from '../../shared/protocol.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DIST = join(ROOT, 'dist');
const CERTS = join(ROOT, 'certs');
const DB_FILE = join(ROOT, 'data', 'game.db');

const DEV = process.argv.includes('--dev');
// 8080 РЅР° СЌС‚РѕР№ РјР°С€РёРЅРµ Р·Р°РЅСЏС‚ РѕС‚Р»Р°РґРѕС‡РЅС‹Рј СЃРµСЂРІРµСЂРѕРј Р±СЂР°СѓР·РµСЂР°, РїРѕСЌС‚РѕРјСѓ dev вЂ” РЅР° 8090
const DEV_PORT = 8090;
const PORT = DEV ? DEV_PORT : 8443;

const log = (...args) => console.log(`[${new Date().toLocaleTimeString('ru-RU')}]`, ...args);

/**
 * Р§РёС‚Р°РµРј .env Р±РµР· Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№. Р¤Р°Р№Р» РІ .gitignore: РєР»СЋС‡Рё РІ РёСЃС‚РѕСЂРёСЋ РЅРµ РїРѕРїР°РґР°СЋС‚.
 * РЈР¶Рµ РІС‹СЃС‚Р°РІР»РµРЅРЅС‹Рµ РїРµСЂРµРјРµРЅРЅС‹Рµ РѕРєСЂСѓР¶РµРЅРёСЏ РЅРµ РїРµСЂРµС‚РёСЂР°РµРј.
 */
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(join(ROOT, '.env'));

/* в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ Р±Р°Р·Р° в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */

const store = new Store(DB_FILE);
log('Р±Р°Р·Р°:', DB_FILE);

// РџРµСЂСЃРѕРЅР°Р¶Рё Рё РёС… С…Р°СЂР°РєС‚РµСЂС‹ вЂ” РІ РґР°РЅРЅС‹С…, Р° РЅРµ РІ РєРѕРґРµ СЃРµСЂРІРµСЂР°.
const npcs = JSON.parse(readFileSync(join(ROOT, 'content', 'npcs.json'), 'utf8')).npcs;
  // РџСЂРµРґРјРµС‚С‹ РјРёСЂР°: РґРІРµСЂРё, РєРЅРѕРїРєРё, Р»СЋРєРё вЂ” СЃ РІРµСЂР±Р°РјРё Рё СѓСЃР»РѕРІРёСЏРјРё.
const props = JSON.parse(readFileSync(join(ROOT, 'content', 'props.json'), 'utf8')).props;
// РњРµСЃС‚Р° РІ РІР°РіРѕРЅРµ, РЅР° РєРѕС‚РѕСЂС‹Рµ СЃР°РґСЏС‚СЃСЏ РёРіСЂРѕРєРё РїСЂРё СЃС‚Р°СЂС‚Рµ: Сѓ РєР°Р¶РґРѕРіРѕ СЃРІРѕС‘.
const seats = JSON.parse(readFileSync(join(ROOT, 'content', 'seats.json'), 'utf8')).seats;

/**
 * Р”РІР° С‡РёСЃР»Р°, РєРѕС‚РѕСЂС‹Рµ РґРІРёРіР°СЋС‚ СЃСЋР¶РµС‚: РїР°РЅРёРєР° Рё РґРѕРІРµСЂРёРµ (0вЂ“100).
 * Р–РёРІСѓС‚ РІ Р±Р°Р·Рµ, С‡С‚РѕР±С‹ РїРµСЂРµР·Р°РїСѓСЃРє СЃРµСЂРІРµСЂР° РЅРµ РѕР±РЅСѓР»СЏР» СЃРѕСЃС‚РѕСЏРЅРёРµ С‚РѕР»РїС‹.
 */
const stats = {
  panic: Number(store.getFlag('panic') ?? 20),
  trust: Number(store.getFlag('trust') ?? 50),
  air: Number(store.getFlag('air') ?? 100),
};

/** РЎРѕСЃС‚РѕСЏРЅРёРµ Р»РѕР±Р±Рё: РєС‚Рѕ РІ СЃРµС‚Рё Рё РЅР°С‡Р°Р»Р°СЃСЊ Р»Рё РёРіСЂР°. */
function broadcastLobby() {
  const payload = JSON.stringify({
    t: MSG.LOBBY,
    players: [...clients.values()].map((client) => client.name),
    started: scenario.running,
  });
  for (const client of clients.values()) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(payload);
  }
}

/** РЎС‚Р°СЂС‚ РёРіСЂС‹: СЃС†РµРЅР°СЂРёР№ Р·Р°РїСѓСЃРєР°РµС‚СЃСЏ РѕРґРёРЅ СЂР°Р·, РґР»СЏ РІСЃРµС… СЃСЂР°Р·Сѓ. */
function startGame(byName) {
  if (scenario.running) return;
  scenario.start();
  seatPlayers();
  log(`РёРіСЂР° РЅР°С‡Р°С‚Р° (${byName})`);
  broadcast({ kind: 'game_start', data: {} });
  broadcastLobby();
}

/**
 * Р Р°СЃСЃР°Р¶РёРІР°РµРј РІСЃРµС… РїРѕ РјРµСЃС‚Р°Рј РґРѕ РЅР°С‡Р°Р»Р° СЃС†РµРЅС‹: РёРЅР°С‡Рµ РёРіСЂРѕРєРё РїРѕСЏРІР»СЏСЋС‚СЃСЏ
 * РІ РѕРґРЅРѕР№ С‚РѕС‡РєРµ РїСЂРѕС…РѕРґР° Рё СЃС‚РѕСЏС‚ РґСЂСѓРі РІ РґСЂСѓРіРµ. РњРµСЃС‚Рѕ Р·Р°РєСЂРµРїР»СЏРµС‚СЃСЏ Р·Р° РёРіСЂРѕРєРѕРј
 * РїРѕ РїРѕСЂСЏРґРєСѓ РІС…РѕРґР° Рё СѓС…РѕРґРёС‚ РµРјСѓ РѕС‚РґРµР»СЊРЅС‹Рј СЃРѕР±С‹С‚РёРµРј вЂ” СЃРµСЂРІРµСЂ Рё РєР»РёРµРЅС‚ РґРѕР»Р¶РЅС‹
 * РѕРґРёРЅР°РєРѕРІРѕ РїРѕРЅРёРјР°С‚СЊ, РіРґРµ РѕРЅ СЃРёРґРёС‚.
 */
function seatPlayers() {
  [...clients.values()].forEach((client, index) => {
    const seat = seats[index % seats.length];
    client.x = seat.x;
    client.z = seat.z;
    client.yaw = seat.yaw;
    store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);

    if (client.ws.readyState !== client.ws.OPEN) return;
    client.ws.send(JSON.stringify({
      t: MSG.EVENT,
      kind: 'spawn',
      data: { x: seat.x, z: seat.z, yaw: seat.yaw, seat: index },
    }));
  });
}

/**
 * Р‘Р»РѕРєРЅРѕС‚ РјС‹СЃР»РµР№. РњС‹СЃР»СЊ РІРёСЃРёС‚ РЅР° СЌРєСЂР°РЅРµ РЅРµ РїРѕ С‚Р°Р№РјРµСЂСѓ, Р° РїРѕРєР° РѕРЅР° РІРµСЂРЅР°:
 * Сѓ РєР°Р¶РґРѕР№ РµСЃС‚СЊ СѓСЃР»РѕРІРёРµ СЃРЅСЏС‚РёСЏ вЂ” С„Р»Р°Рі РјРёСЂР°. Р’Р·Р°РёРјРѕРґРµР№СЃС‚РІРёРµ СЃ С„РѕСЂС‚РѕС‡РєРѕР№
 * СЃС‚Р°РІРёС‚ window_open, Рё РјС‹СЃР»СЊ РїСЂРѕ РґСѓС…РѕС‚Сѓ СЃРЅРёРјР°РµС‚СЃСЏ СЃР°РјР°.
 */
const notes = new Map();
const noteUntil = new Map();

/** РќР°СЃРєРѕР»СЊРєРѕ РІР°РіРѕРЅ СЃРІРµС‚Р»РµРµС‚ РѕС‚ Р»Р°РјРїС‹ Рё С‡РµСЂРµР· СЃРєРѕР»СЊРєРѕ СЃРµРєСѓРЅРґ РѕРЅР° РїРѕСЏРІР»СЏРµС‚СЃСЏ. */
const LAMP_LIGHT = 0.9;
const LAMP_DELAY_MS = 2200;

/**
 * Р›Р°РјРїР° РёР· Р±СѓС‚С‹Р»РєРё Рё С‚РµР»РµС„РѕРЅР°. РЎС‚Р°РІРёС‚СЃСЏ РІ РјРёСЂРµ РѕРґРЅР°: С‚РѕС‡РєР° РЅСѓР¶РЅР° РІСЃРµРј
 * РєР»РёРµРЅС‚Р°Рј, РїРѕСЌС‚РѕРјСѓ РѕРЅР° СѓС…РѕРґРёС‚ СЃРѕР±С‹С‚РёРµРј, Р° РєРѕРѕСЂРґРёРЅР°С‚С‹ Р¶РёРІСѓС‚ РІ Р±Р°Р·Рµ вЂ”
 * С‡С‚РѕР±С‹ РїРѕР·РґРЅРёР№ РёРіСЂРѕРє СѓРІРёРґРµР» СЃРІРµС‚ С‚Р°Рј, РіРґРµ РµРіРѕ РѕСЃС‚Р°РІРёР»Рё.
 */
function placeLamp(x, z) {
  store.setFlag('lamp_x', x);
  store.setFlag('lamp_z', z);
  scenario.state.lights = LAMP_LIGHT;
  broadcast({ kind: 'lamp', data: { x, z } });
  broadcast({ kind: 'lights', data: { value: LAMP_LIGHT } });
  log(`Р»Р°РјРїР° РїРѕСЃС‚Р°РІР»РµРЅР°: ${x.toFixed(2)}, ${z.toFixed(2)}`);
}

function broadcastNotes() {
  broadcast({ kind: 'notes', data: { list: [...notes].map(([id, text]) => ({ id, text })) } });
}

function addNote({ id, text, until }) {
  const key = String(id ?? text);
  if (!text) return;
  // СЃРІРµС‚ СѓР¶Рµ СЃРѕР±СЂР°Р»Рё вЂ” РјС‹СЃР»СЊ РїСЂРѕ С‚РµРјРЅРѕС‚Сѓ СѓСЃС‚Р°СЂРµР»Р° СЂР°РЅСЊС€Рµ, С‡РµРј РµС‘ РїРѕРєР°Р·Р°Р»Рё
  if (until && store.getFlag(String(until)) === '1') return;

  const same = notes.get(key) === text && (!until || noteUntil.get(key) === until);
  if (same) return;

  notes.set(key, String(text));
  if (until) noteUntil.set(key, String(until));
  broadcastNotes();
}

function dropNote(id) {
  if (!notes.delete(String(id))) return;
  noteUntil.delete(String(id));
  broadcastNotes();
}

/** Р¤Р»Р°Рі СЃСЂР°Р±РѕС‚Р°Р» вЂ” РјС‹СЃР»Рё, РєРѕС‚РѕСЂС‹Рµ РЅР° РЅРµРіРѕ РѕРїРёСЂР°Р»РёСЃСЊ, Р±РѕР»СЊС€Рµ РЅРµ Р°РєС‚СѓР°Р»СЊРЅС‹. */
function dropNotesByFlag(flag) {
  let changed = false;
  for (const [id, until] of noteUntil) {
    if (until !== flag) continue;
    notes.delete(id);
    noteUntil.delete(id);
    changed = true;
  }
  if (changed) broadcastNotes();
}

function clearNotes() {
  notes.clear();
  noteUntil.clear();
  broadcastNotes();
}

/** Р Р°СЃСЃС‹Р»РєР° СЃРѕР±С‹С‚РёСЏ РІСЃРµРј РїРѕРґРєР»СЋС‡С‘РЅРЅС‹Рј; РґРµР№СЃС‚РІРёСЏ СЃРѕ СЃС‚Р°С‚РёСЃС‚РёРєРѕР№ РЅРµ РїРµСЂРµСЃС‹Р»Р°СЋС‚СЃСЏ. */
function broadcast(event) {
  if (event.kind === 'stat') {
    changeStat(event.data.key, event.data.delta);
    return;
  }

  if (event.kind === 'radio') {
    startRadio(event.data);
    return;
  }

  // РјС‹СЃР»СЊ РіРµСЂРѕСЏ вЂ” СЌС‚Рѕ СЃС‚СЂРѕРєР° РІ Р±Р»РѕРєРЅРѕС‚Рµ, Р° РЅРµ РІСЃРїР»С‹РІР°СЋС‰Р°СЏ РїРѕРґСЃРєР°Р·РєР°
  if (event.kind === 'thought') {
    addNote(event.data);
    return;
  }

  if (event.kind === 'unthought') {
    dropNote(event.data.id);
    return;
  }

  const payload = JSON.stringify({ t: MSG.EVENT, kind: event.kind, data: event.data });
  for (const client of clients.values()) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(payload);
  }
}

/**
 * РћР±СЉСЏРІР»РµРЅРёРµ РїРѕ РІР°РіРѕРЅСѓ. РРіСЂР°РµС‚ РЅРµСЃРєРѕР»СЊРєРѕ СЂР°Р·: РЅР° РІС‚РѕСЂРѕРј РіРµСЂРѕР№ РїРѕРЅРёРјР°РµС‚,
 * С‡С‚Рѕ СЌС‚Рѕ Р·Р°РїРёСЃСЊ, СЃ С‡РµС‚РІС‘СЂС‚РѕРіРѕ С‚РѕР»РїР° РЅР°С‡РёРЅР°РµС‚ РїР°РЅРёРєРѕРІР°С‚СЊ.
 */
const radioTimers = [];

function startRadio({ text, repeats = 4, interval = 4 }) {
  for (let i = 1; i <= repeats; i++) {
    radioTimers.push(setTimeout(() => {
      // СЃР°РјР° СЂРµРїР»РёРєР° вЂ” РјРіРЅРѕРІРµРЅРЅР°СЏ: РѕРЅР° Р·РІСѓС‡РёС‚ Рё Р·Р°С‚РёС…Р°РµС‚
      broadcast({ kind: 'say', data: { text: `РџРѕ РІР°РіРѕРЅСѓ: В«${text}В»` } });

      if (i === 2) {
        setTimeout(() => broadcast({
          kind: 'thought',
          data: {
            id: 'radio_record',
            text: 'РџРѕС…РѕР¶Рµ, СЌС‚Рѕ Р·Р°РїРёСЃСЊ. РњР°С€РёРЅРёСЃС‚ СЃР°Рј РЅР° СЃРІСЏР·СЊ РЅРµ РІС‹Р№РґРµС‚.',
            until: 'announcer_off',
          },
        }), 600);
      }

      if (i === 4) {
        changeStat('panic', 12);
      }
    }, i * interval * 1000));
  }
}

function stopRadio() {
  while (radioTimers.length > 0) clearTimeout(radioTimers.pop());
}

function changeStat(key, delta) {
  if (key !== 'panic' && key !== 'trust' && key !== 'air') return;

  const next = Math.max(0, Math.min(100, Math.round(stats[key] + Number(delta ?? 0))));
  if (next === stats[key]) return;

  stats[key] = next;
  store.setFlag(key, next);
  log(`РјРёСЂ: ${key} в†’ ${next}`);
  broadcast({ kind: 'stats', data: { panic: stats.panic, trust: stats.trust, air: stats.air } });
}
const agents = new AgentRuntime({
  store,
  key: process.env.DEEPSEEK_API_KEY ?? null,
  localUrl: process.env.LOCAL_LLM_URL ?? null,
  localModel: process.env.LOCAL_LLM_MODEL ?? 'qwen2.5:7b-instruct',
  localFormat: process.env.LOCAL_LLM_FORMAT ?? 'ollama',
  localKey: process.env.LOCAL_LLM_KEY ?? null,
  log,
});

// РџСЂРёРѕСЂРёС‚РµС‚ РјРѕР·РіРѕРІ: Р»РѕРєР°Р»СЊРЅР°СЏ РјРѕРґРµР»СЊ в†’ DeepSeek в†’ РїСЂР°РІРёР»Р°.
// РџСЂРѕРІРµСЂСЏРµРј РґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ Р»РѕРєР°Р»СЊРЅРѕР№ РЅР° СЃС‚Р°СЂС‚Рµ Рё РіРѕРІРѕСЂРёРј РІСЃР»СѓС…, С‡С‚Рѕ РІРєР»СЋС‡РёР»РѕСЃСЊ.
if (agents.mode === 'local') {
  probeLocal(agents.localUrl, agents.localModel, agents.localFormat, agents.localKey).then((ok) => {
    log(ok
      ? `Р°РіРµРЅС‚С‹: Р»РѕРєР°Р»СЊРЅР°СЏ РјРѕРґРµР»СЊ ${agents.localModel} (${agents.localUrl})`
      : `Р°РіРµРЅС‚С‹: Р»РѕРєР°Р»СЊРЅР°СЏ РјРѕРґРµР»СЊ РЅРµРґРѕСЃС‚СѓРїРЅР°, РѕС‚РєР°С‚ РЅР° ${agents.key ? 'DeepSeek' : 'РїСЂР°РІРёР»Р°'}`);
  });
} else {
  log('Р°РіРµРЅС‚С‹:', agents.key ? 'DeepSeek РїРѕ API' : 'РїСЂР°РІРёР»Р° (РєР»СЋС‡Р° РЅРµС‚)');
}

// РЎС†РµРЅР°СЂРёР№ С‡РёС‚Р°РµС‚СЃСЏ РѕРґРёРЅ СЂР°Р· РЅР° СЃС‚Р°СЂС‚Рµ. Р¤Р»Р°РіРё РјРёСЂР° Р¶РёРІСѓС‚ РІ Р±Р°Р·Рµ,
// РїРѕСЌС‚РѕРјСѓ РїРµСЂРµР·Р°РїСѓСЃРє СЃРµСЂРІРµСЂР° РЅРµ РѕС‚РєР°С‚С‹РІР°РµС‚ В«РЅР°Р№РґРµРЅ С„РѕРЅР°СЂСЊВ» Рё РїРѕРґРѕР±РЅРѕРµ.
const scenario = Scenario.load(join(ROOT, 'content', 'scenario', 'metro_tunnel.json'), {
  store,
  log,
  broadcast,
});

/* в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ HTTP в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJson(req, limit = 4096) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('too_large');
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function bearer(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

const loginRateLimit = new Map();

/** Р”Рѕ 12 РїРѕРїС‹С‚РѕРє РІС…РѕРґР° РІ РјРёРЅСѓС‚Сѓ СЃ РѕРґРЅРѕРіРѕ IP: scrypt РёРЅР°С‡Рµ РјРѕР¶РЅРѕ Р·Р°С„Р»СѓРґРёС‚СЊ. */
function isLoginRateLimited(ip) {
  const now = Date.now();
  const entry = loginRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    loginRateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  if (loginRateLimit.size > 10_000) loginRateLimit.clear(); // РЅРµ РєРѕРїРёРј РјС‘СЂС‚РІС‹Рµ IP
  return entry.count > 12;
}

async function handleLogin(req, res) {
  const ip = req.socket?.remoteAddress ?? 'unknown';
  if (isLoginRateLimited(ip)) {
    return json(res, 429, {
      error: { code: 'too_many_requests', message: 'РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ РїРѕРїС‹С‚РѕРє РІС…РѕРґР°, РїРѕРґРѕР¶РґРёС‚Рµ РјРёРЅСѓС‚Сѓ' },
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: { code: 'bad_json', message: 'РѕР¶РёРґР°Р»СЃСЏ JSON' } });
  }

  const login = String(body.login ?? '').trim();
  const password = String(body.password ?? '');

  if (!AUTH.LOGIN_RE.test(login)) {
    return json(res, 400, {
      error: { code: 'bad_login', message: 'Р»РѕРіРёРЅ: Р»Р°С‚РёРЅРёС†Р°, С†РёС„СЂС‹ Рё _, РѕС‚ 3 РґРѕ 16 СЃРёРјРІРѕР»РѕРІ' },
    });
  }
  if (password.length < AUTH.PASSWORD_MIN || password.length > AUTH.PASSWORD_MAX) {
    return json(res, 400, {
      error: { code: 'bad_password', message: `РїР°СЂРѕР»СЊ РѕС‚ ${AUTH.PASSWORD_MIN} РґРѕ ${AUTH.PASSWORD_MAX} СЃРёРјРІРѕР»РѕРІ` },
    });
  }

  let player = store.playerByLogin(login);

  if (player) {
    const ok = await verifyPassword(password, player.pass_salt, player.pass_hash);
    if (!ok) {
      log('РІС…РѕРґ: РЅРµРІРµСЂРЅС‹Р№ РїР°СЂРѕР»СЊ РґР»СЏ', login);
      return json(res, 401, { error: { code: 'bad_credentials', message: 'РЅРµРІРµСЂРЅС‹Р№ РїР°СЂРѕР»СЊ' } });
    }
  } else {
    const { hash, salt } = await hashPassword(password);
    try {
      player = store.createPlayer(login, toRussianName(login), hash, salt);
      log('РІС…РѕРґ: СЃРѕР·РґР°РЅ РёРіСЂРѕРє', login, 'в†’', player.name);
    } catch (insertError) {
      // РїР°СЂР°Р»Р»РµР»СЊРЅС‹Р№ Р·Р°РїСЂРѕСЃ РјРѕРі СЃРѕР·РґР°С‚СЊ С‚Р°РєРѕРіРѕ Р¶Рµ РёРіСЂРѕРєР° РЅР° СЃРµРєСѓРЅРґСѓ СЂР°РЅСЊС€Рµ
      player = store.playerByLogin(login);
      if (!player) {
        log('РІС…РѕРґ: РѕС€РёР±РєР° СЃРѕР·РґР°РЅРёСЏ РёРіСЂРѕРєР° вЂ”', insertError?.message ?? insertError);
        return json(res, 500, { error: { code: 'server_error', message: 'РѕС€РёР±РєР° СЂРµРіРёСЃС‚СЂР°С†РёРё' } });
      }
      const ok = await verifyPassword(password, player.pass_salt, player.pass_hash);
      if (!ok) {
        return json(res, 409, { error: { code: 'login_taken', message: 'Р»РѕРіРёРЅ СѓР¶Рµ Р·Р°РЅСЏС‚ РґСЂСѓРіРёРј РїР°СЂРѕР»РµРј' } });
      }
    }
  }

  const token = newToken();
  store.createSession(hashToken(token), player.id, Date.now() + AUTH.SESSION_HOURS * 3600_000);

  return json(res, 200, { token, playerId: player.id, name: player.name });
}

function handleMe(req, res) {
  const token = bearer(req);
  if (!token) return json(res, 401, { error: { code: 'bad_token', message: 'РЅРµС‚ С‚РѕРєРµРЅР°' } });

  const session = store.session(hashToken(token));
  if (!session || session.expires_at < Date.now()) {
    return json(res, 401, { error: { code: 'bad_token', message: 'СЃРµСЃСЃРёСЏ РёСЃС‚РµРєР»Р°' } });
  }

  const player = store.playerById(session.player_id);
  if (!player) return json(res, 401, { error: { code: 'bad_token', message: 'РёРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ' } });

  return json(res, 200, { playerId: player.id, name: player.name, login: player.login });
}

function serveStatic(req, res) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return notFound(res);
  }

  if (pathname === '/') pathname = '/index.html';

  const target = normalize(join(DIST, pathname.replace(/^\/+/, '')));
  if (!target.startsWith(DIST + sep)) return notFound(res); // РІС‹С…РѕРґ Р·Р° РїСЂРµРґРµР»С‹ dist

  if (!existsSync(target) || !statSync(target).isFile()) {
    if (!pathname.startsWith('/api/') && existsSync(join(DIST, 'index.html'))) {
      return sendFile(res, join(DIST, 'index.html'));
    }
    return notFound(res);
  }
  return sendFile(res, target);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

function sendFile(res, file) {
  const stream = createReadStream(file);
  stream.on('error', (err) => {
    log('РѕС€РёР±РєР° РѕС‚РґР°С‡Рё СЃС‚Р°С‚РёРєРё:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('internal server error');
    }
  });
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  stream.pipe(res);
}

async function handleHttp(req, res) {
  const url = new URL(req.url, 'http://localhost');

  // СЃРѕРґРµСЂР¶РёРјРѕРµ (СЃС†РµРЅР°СЂРёР№, РєР°С‚СЃС†РµРЅС‹, РїРµСЂСЃРѕРЅР°Р¶Рё) РѕС‚РґР°С‘Рј РёР· РїР°РїРєРё content,
  // С‡С‚РѕР±С‹ С‚РµРєСЃС‚С‹ РїСЂР°РІРёР»РёСЃСЊ Р±РµР· РїРµСЂРµСЃР±РѕСЂРєРё РєР»РёРµРЅС‚Р°
  if (url.pathname.startsWith('/api/content/')) {
    const CONTENT = join(ROOT, 'content');
    const relative = decodeURIComponent(url.pathname.slice('/api/content/'.length));
    const file = normalize(join(CONTENT, relative));

    if (!file.startsWith(CONTENT + sep)) {
      return json(res, 404, { error: { code: 'not_found', message: 'РІС‹С…РѕРґ Р·Р° РїСЂРµРґРµР»С‹ content' } });
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      return json(res, 404, { error: { code: 'not_found', message: relative } });
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/login') return handleLogin(req, res);
  if (req.method === 'GET' && url.pathname === '/api/me') return handleMe(req, res);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, players: clients.size, uptime: Math.round(process.uptime()) });
  }
  if (url.pathname.startsWith('/api/')) {
    return json(res, 404, { error: { code: 'not_found', message: url.pathname } });
  }

  return serveStatic(req, res);
}

/* в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ РјРёСЂ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */

/** РџРѕРґРєР»СЋС‡С‘РЅРЅС‹Рµ РєР»РёРµРЅС‚С‹: id РёРіСЂРѕРєР° в†’ Р·Р°РїРёСЃСЊ. */
const clients = new Map();

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function inWorld(x, z) {
  return {
    x: clamp(x, WORLD.minX + 0.25, WORLD.maxX - 0.25),
    z: clamp(z, WORLD.minZ + 0.3, WORLD.maxZ - 0.3),
  };
}

function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    let client = null;
    let messageCount = 0;
    let windowStart = Date.now();

    const helloTimer = setTimeout(() => {
      if (!client) {
        ws.close(CLOSE.UNAUTHORIZED, 'hello timeout');
      }
    }, HELLO_TIMEOUT_MS);

    ws.on('message', (raw) => {
      // РїСЂРѕСЃС‚Р°СЏ Р·Р°С‰РёС‚Р° РѕС‚ С„Р»СѓРґР°: Р±РѕР»СЊС€Рµ 80 СЃРѕРѕР±С‰РµРЅРёР№ РІ СЃРµРєСѓРЅРґСѓ вЂ” Р·Р°РєСЂС‹РІР°РµРј
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        messageCount = 0;
      }
      if (++messageCount > 80) {
        log('ws: С„Р»СѓРґ РѕС‚ РёРіСЂРѕРєР°', client?.playerId ?? 'вЂ”');
        ws.close(CLOSE.RATE_LIMITED, 'rate limited');
        return;
      }

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(CLOSE.BAD_MESSAGE, 'json expected');
        return;
      }

      switch (msg?.t) {
        case MSG.HELLO: {
          if (msg.v !== PROTOCOL_VERSION) {
            ws.close(CLOSE.BAD_VERSION, 'protocol version mismatch');
            return;
          }

          const session = typeof msg.token === 'string' ? store.session(hashToken(msg.token)) : null;
          if (!session || session.expires_at < Date.now()) {
            log('ws: РѕС‚РєР°Р·, С‚РѕРєРµРЅ РЅРµ РїСЂРёРЅСЏС‚', ip);
            ws.close(CLOSE.FORBIDDEN, 'bad token');
            return;
          }

          const player = store.playerById(session.player_id);
          if (!player) {
            ws.close(CLOSE.FORBIDDEN, 'no player');
            return;
          }

          clearTimeout(helloTimer);

          const saved = store.loadState(player.id);
          let inventory = [...START_INVENTORY];
          if (saved?.inventory) {
            try {
              const parsed = JSON.parse(saved.inventory);
              if (Array.isArray(parsed) && parsed.some(Boolean)) inventory = sanitizeInventory(parsed);
            } catch {
              // Р±РёС‚С‹Р№ json РІ Р±Р°Р·Рµ вЂ” РЅР°С‡РёРЅР°РµРј СЃРѕ СЃС‚Р°СЂС‚РѕРІРѕРіРѕ РЅР°Р±РѕСЂР°, РЅРѕ РЅРµ РїР°РґР°РµРј
            }
          }

          client = {
            ws,
            playerId: player.id,
            name: player.name,
            x: saved?.x ?? WORLD.spawnX,
            z: saved?.z ?? WORLD.spawnZ,
            yaw: saved?.yaw ?? 0,
            inventory,
          };

          // РѕРґРЅРѕ СЃРѕРµРґРёРЅРµРЅРёРµ РЅР° РёРіСЂРѕРєР°: СЃС‚Р°СЂРѕРµ Р·Р°РєСЂС‹РІР°РµРј
          const previous = clients.get(player.id);
          if (previous && previous.ws !== ws) previous.ws.close(CLOSE.FORBIDDEN, 'replaced');

          clients.set(player.id, client);
          log(`ws: РёРіСЂРѕРє ${player.name} (#${player.id}) РІРѕС€С‘Р», ${clients.size} РІ СЃРµС‚Рё`);

          ws.send(JSON.stringify({
            t: MSG.WELCOME,
            you: player.id,
            name: player.name,
            serverTime: Date.now(),
          }));

          ws.send(JSON.stringify({
            t: MSG.SNAPSHOT,
            you: player.id,
            self: { id: player.id, name: player.name, x: client.x, z: client.z, yaw: client.yaw },
            players: [...clients.values()].map(toView),
            inventory: client.inventory,
            npcs: npcs.map((npc) => ({
              id: npc.id,
              name: npc.name,
              pos: npc.pos,
              yaw: npc.yaw,
              model: npc.model,
            })),
          }));

          // РґРѕРіРѕРЅСЏРµРј СЃСЋР¶РµС‚: СЃРІРµС‚ Рё Р·Р°РґР°РЅРёРµ, РєРѕС‚РѕСЂС‹Рµ СѓР¶Рµ СЃР»СѓС‡РёР»РёСЃСЊ Р±РµР· РЅР°СЃ
          for (const event of scenario.stateEvents()) {
            ws.send(JSON.stringify({ t: MSG.EVENT, kind: event.kind, data: event.data }));
          }
          // Рё С‚РµРєСѓС‰РµРµ СЃРѕСЃС‚РѕСЏРЅРёРµ С‚РѕР»РїС‹
          ws.send(JSON.stringify({
            t: MSG.EVENT,
            kind: 'stats',
            data: { panic: stats.panic, trust: stats.trust, air: stats.air },
          }));

          // Р±Р»РѕРєРЅРѕС‚: РјС‹СЃР»Рё, РєРѕС‚РѕСЂС‹Рµ РІРёСЃСЏС‚ Сѓ РІСЃРµС…, РЅСѓР¶РЅС‹ Рё РѕРїРѕР·РґР°РІС€РµРјСѓ
          ws.send(JSON.stringify({
            t: MSG.EVENT,
            kind: 'notes',
            data: { list: [...notes].map(([id, text]) => ({ id, text })) },
          }));

          // СЃРІРµС‚ СѓР¶Рµ СЃРѕР±СЂР°Р»Рё вЂ” РїРѕР·РґРЅРёР№ РёРіСЂРѕРє РґРѕР»Р¶РµРЅ СѓРІРёРґРµС‚СЊ Р»Р°РјРїСѓ РЅР° РјРµСЃС‚Рµ
          if (store.getFlag('has_light') === '1' && store.getFlag('lamp_x') !== null) {
            scenario.state.lights = LAMP_LIGHT;
            ws.send(JSON.stringify({
              t: MSG.EVENT,
              kind: 'lamp',
              data: { x: Number(store.getFlag('lamp_x')), z: Number(store.getFlag('lamp_z')) },
            }));
          }

          // СЃРѕСЃС‚РѕСЏРЅРёРµ Р»РѕР±Р±Рё: РєС‚Рѕ РµС‰С‘ РІ СЃРµС‚Рё Рё РЅР°С‡Р°Р»Р°СЃСЊ Р»Рё РёРіСЂР°
          broadcastLobby();
          return;
        }

        case MSG.COMBINE: {
          if (!client) return;

          const i = Number(msg.i);
          const j = Number(msg.j);
          if (!Number.isInteger(i) || !Number.isInteger(j) || i === j) return;
          if (i < 0 || j < 0 || i >= client.inventory.length || j >= client.inventory.length) return;

          const first = client.inventory[i];
          const second = client.inventory[j];

          if (!first || !second) {
            sendInventory(ws, client.inventory, 'РџСѓСЃС‚РѕР№ СЃР»РѕС‚');
            return;
          }

          const recipe = findRecipe(first, second);
          if (!recipe) {
            sendInventory(ws, client.inventory, 'РР· СЌС‚РѕРіРѕ РЅРёС‡РµРіРѕ РЅРµ РІС‹С…РѕРґРёС‚');
            return;
          }

          client.inventory[i] = recipe.result;
          client.inventory[j] = null;
          log(`РёРіСЂРѕРє ${client.name}: ${first} + ${second} в†’ ${recipe.result}`);

          store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);
          sendInventory(ws, client.inventory, recipe.text);

          if (recipe.result === 'flashlight') {
            store.setFlag('has_light', '1');
            dropNotesByFlag('has_light');
            scenario.fire('flag', { flag: 'has_light' });

            // С‚РѕС‚, РєС‚Рѕ СЃРѕР±СЂР°Р», РІРёРґРёС‚, РєР°Рє СЃС‚Р°РІРёС‚ С‚РµР»РµС„РѕРЅ РЅР° РїРѕР»; РѕСЃС‚Р°Р»СЊРЅС‹Рµ вЂ”
            // РєР°Рє РІР°РіРѕРЅ СЃРІРµС‚Р»РµРµС‚, РєРѕРіРґР° Р»Р°РјРїР° СѓР¶Рµ СЃС‚РѕРёС‚
            ws.send(JSON.stringify({ t: MSG.EVENT, kind: 'cutscene', data: { id: 'craft_light' } }));
            const lampX = client.x - Math.sin(client.yaw) * 0.75;
            const lampZ = client.z - Math.cos(client.yaw) * 0.75;
            setTimeout(() => placeLamp(lampX, lampZ), LAMP_DELAY_MS);

            // СЃРІРµС‚ СѓСЃРїРѕРєР°РёРІР°РµС‚ С‚РѕР»РїСѓ Рё РґРѕР±Р°РІР»СЏРµС‚ РґРѕРІРµСЂРёСЏ Рє С‚РѕРјСѓ, РєС‚Рѕ РµРіРѕ РЅР°С€С‘Р»
            changeStat('panic', -8);
            changeStat('trust', 4);
          }
          return;
        }

        case MSG.ZONE: {
          if (!client) return;
          const chunk = String(msg.chunk ?? '');
          if (!chunk) return;
          scenario.fire('zone', { chunk });
          return;
        }

        case MSG.START: {
          if (!client) return;
          startGame(client.name);
          return;
        }

        case MSG.INTERACT: {
          if (!client) return;

          const prop = props.find((item) => item.id === String(msg.id ?? ''));
          if (!prop) return;

          const verb = prop.verbs.find((item) => item.id === String(msg.verb ?? ''));
          if (!verb) return;

          // СѓСЃР»РѕРІРёРµ Р·Р°РґР°С‘С‚СЃСЏ С„Р»Р°РіРѕРј: РЅР°РїСЂРёРјРµСЂ, Р»СЋРє Р±РµР· Р»РѕРјР° РЅРµ РѕС‚РєСЂС‹С‚СЊ
          if (verb.requiresFlag && store.getFlag(verb.requiresFlag) !== '1') {
            ws.send(JSON.stringify({
              t: MSG.EVENT,
              kind: 'prop',
              data: { id: prop.id, verb: verb.id, text: 'РџРѕРєР° РЅРµС‡РµРј СЌС‚Рѕ СЃРґРµР»Р°С‚СЊ.' },
            }));
            return;
          }

          if (verb.flag) {
            store.setFlag(verb.flag, verb.value ? '1' : '0');
            // РјС‹СЃР»СЊ, РєРѕС‚РѕСЂР°СЏ РѕРїРёСЂР°Р»Р°СЃСЊ РЅР° СЌС‚РѕС‚ С„Р»Р°Рі, СѓСЃС‚Р°СЂРµР»Р° вЂ” СЃРЅРёРјР°РµРј РґРѕ РЅРѕРІС‹С…
            dropNotesByFlag(verb.flag);
            // СЃС†РµРЅР°СЂРёР№ РґРѕР»Р¶РµРЅ СѓР·РЅР°С‚СЊ Рѕ С„Р»Р°РіРµ, РёРЅР°С‡Рµ С‚СЂРёРіРіРµСЂС‹ РЅР° РЅРµРіРѕ РЅРµ СЃСЂР°Р±РѕС‚Р°СЋС‚
            scenario.fire('flag', { flag: verb.flag });
          }

          // РѕС‚РєСЂС‹С‚Р°СЏ РґРІРµСЂСЊ РєР°Р±РёРЅС‹ РїСѓРіР°РµС‚: С‚Р°Рј РЅРёРєРѕРіРѕ РЅРµС‚, Рё СЌС‚Рѕ Р·Р°РјРµС‚РЅРѕ
          if (verb.id === 'open') changeStat('panic', 4);
          // РѕС‚РєСЂС‹С‚Р°СЏ С„РѕСЂС‚РѕС‡РєР° РІРѕР·РІСЂР°С‰Р°РµС‚ РІРѕР·РґСѓС…
          if (verb.air) changeStat('air', Number(verb.air));

          // Сѓ РІРµСЂР±Р° РјРѕР¶РµС‚ Р±С‹С‚СЊ СЃРІРѕСЏ РјРёРЅРё-СЃС†РµРЅР° вЂ” РїСЂРѕРёРіСЂС‹РІР°РµРј РµС‘ РІСЃРµРј
          if (verb.cutscene) {
            broadcast({ kind: 'cutscene', data: { id: verb.cutscene } });
          }

          log(`РёРіСЂРѕРє ${client.name}: ${prop.id} в†’ ${verb.id}`);
          ws.send(JSON.stringify({
            t: MSG.EVENT,
            kind: 'prop',
            data: { id: prop.id, verb: verb.id, text: verb.text },
          }));
          scenario.fire('interact', { id: prop.id, verb: verb.id });
          return;
        }

        case MSG.SAY: {
          if (!client) return;

          const to = String(msg.to ?? '');
          const text = String(msg.text ?? '').trim().slice(0, 300);
          const npc = npcs.find((item) => item.id === to);
          if (!npc || !text) return;

          // РЅРµ Р±РѕР»СЊС€Рµ РѕРґРЅРѕРіРѕ РІРѕРїСЂРѕСЃР° РІ СЃРµРєСѓРЅРґСѓ СЃ С‡РµР»РѕРІРµРєР°: РјРѕРґРµР»СЊ РЅРµ Р±РµСЃРїР»Р°С‚РЅР°СЏ
          const now = Date.now();
          if (client.lastAsk && now - client.lastAsk < 1200) return;
          client.lastAsk = now;

          void respond(ws, client, npc, text);
          return;
        }

        case MSG.INPUT: {
          if (!client) return;
          const x = Number(msg.x);
          const z = Number(msg.z);
          const yaw = Number(msg.yaw);
          if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;

          // Р·Р°С‰РёС‚Р° РѕС‚ С‚РµР»РµРїРѕСЂС‚Р°: РїСЂС‹Р¶РѕРє Р±РѕР»СЊС€Рµ РґРІСѓС… РјРµС‚СЂРѕРІ вЂ” РІРѕР·РІСЂР°С‰Р°РµРј РёРіСЂРѕРєР°
          // РЅР° СЃРµСЂРІРµСЂРЅСѓСЋ РїРѕР·РёС†РёСЋ, РёРЅР°С‡Рµ РєР»РёРµРЅС‚ РїСЂРѕРґРѕР»Р¶РёС‚ СЃР»Р°С‚СЊ РґР°Р»СЊС€Рµ Рё РЅР°РІСЃРµРіРґР°
          // СЂР°Р·РѕР№РґС‘С‚СЃСЏ СЃ РѕСЃС‚Р°Р»СЊРЅС‹РјРё
          if (Math.hypot(x - client.x, z - client.z) > 2) {
            ws.send(JSON.stringify({
              t: MSG.SNAPSHOT,
              you: client.playerId,
              self: { id: client.playerId, name: client.name, x: client.x, z: client.z, yaw: client.yaw },
              players: [...clients.values()].map(toView),
              inventory: client.inventory,
              npcs: npcs.map((npc) => ({
                id: npc.id,
                name: npc.name,
                pos: npc.pos,
                yaw: npc.yaw,
                model: npc.model,
              })),
            }));
            return;
          }

          const clamped = inWorld(x, z);
          client.x = clamped.x;
          client.z = clamped.z;
          client.yaw = yaw;
          return;
        }

        case MSG.PING: {
          ws.send(JSON.stringify({
            t: MSG.PONG,
            id: msg.id,
            clientTime: msg.clientTime,
            serverTime: Date.now(),
          }));
          return;
        }

        case MSG.READY: {
          return;
        }

        default:
          ws.send(JSON.stringify({ t: MSG.ERROR, code: 'unknown_message', message: String(msg?.t) }));
      }
    });

    ws.on('close', (code) => {
      clearTimeout(helloTimer);
      if (!client) return;
      if (clients.get(client.playerId) === client) clients.delete(client.playerId);
      store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);
      log(`ws: РёРіСЂРѕРє ${client.name} (#${client.playerId}) РІС‹С€РµР», РєРѕРґ ${code}, ${clients.size} РІ СЃРµС‚Рё`);

      // РІСЃРµ СѓС€Р»Рё вЂ” СЃС†РµРЅР°СЂРёР№ Рё СЃРѕСЃС‚РѕСЏРЅРёРµ С‚РѕР»РїС‹ РЅР°С‡РёРЅР°СЋС‚СЃСЏ Р·Р°РЅРѕРІРѕ
      if (clients.size === 0) {
        scenario.reset();
        stopRadio();
        clearNotes();
        stats.panic = 20;
        stats.trust = 50;
        stats.air = 100;
        store.setFlag('panic', 20);
        store.setFlag('trust', 50);
        store.setFlag('air', 100);
      }

      broadcastLobby();
    });

    ws.on('error', (err) => log('ws: РѕС€РёР±РєР°', err.message));
  });
}

function toView(client) {
  return { id: client.playerId, name: client.name, x: client.x, z: client.z, yaw: client.yaw };
}

function sendInventory(ws, slots, text = '') {
  ws.send(JSON.stringify({ t: MSG.INVENTORY, slots, text }));
}

/** РћС‚РїСЂР°РІР»СЏРµРј РѕС‚РІРµС‚ Р°РіРµРЅС‚Р° РїРѕ РєСѓСЃРєР°Рј: РІРёРґРЅРѕ, С‡С‚Рѕ РѕРЅ РґСѓРјР°РµС‚, Р° РЅРµ РјРѕР»С‡РёС‚. */
async function respond(ws, client, npc, text) {
  // РµСЃР»Рё РёРіСЂРѕРє СѓС€С‘Р», РїРѕРєР° РјРѕРґРµР»СЊ РґСѓРјР°РµС‚, Р·Р°РїСЂРѕСЃ Рє РЅРµР№ РЅР°РґРѕ РѕР±РѕСЂРІР°С‚СЊ
  const controller = new AbortController();
  const onClose = () => controller.abort();
  ws.once('close', onClose);

  try {
    for await (const delta of agents.reply({
      npc,
      playerId: client.playerId,
      playerName: client.name,
      text,
      signal: controller.signal,
      onResult: (answer) => {
        // С‡РёСЃР»Р° РёР· РѕС‚РІРµС‚Р° Р°РіРµРЅС‚Р° РјРµРЅСЏСЋС‚ СЃРѕСЃС‚РѕСЏРЅРёРµ РјРёСЂР° вЂ” СЌС‚Рѕ РµРіРѕ РІР»РёСЏРЅРёРµ РЅР° С‚РѕР»РїСѓ
        if (answer.trustDelta) changeStat('trust', answer.trustDelta);
        if (answer.panicDelta) changeStat('panic', answer.panicDelta);
        if (answer.actionFlag && answer.actionFlag !== 'none') {
          log(`Р°РіРµРЅС‚ ${npc.id}: ${answer.actionFlag}`);
        }
      },
    })) {
      if (ws.readyState !== ws.OPEN || controller.signal.aborted) break;
      ws.send(JSON.stringify({ t: MSG.NPC_REPLY, id: npc.id, delta }));
    }
    if (ws.readyState === ws.OPEN && !controller.signal.aborted) {
      ws.send(JSON.stringify({ t: MSG.NPC_REPLY, id: npc.id, done: true }));
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      log('Р°РіРµРЅС‚: СЃР±РѕР№ РѕС‚РІРµС‚Р° вЂ”', error?.message ?? error);
    }
  } finally {
    ws.off('close', onClose);
  }
}

/* в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ Р·Р°РїСѓСЃРє в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ */

function createServer() {
  if (DEV) {
    return { server: createHttpServer(handleHttp), scheme: 'http' };
  }

  const keyPath = join(CERTS, 'key.pem');
  const certPath = join(CERTS, 'cert.pem');

  if (existsSync(keyPath) && existsSync(certPath)) {
    return {
      server: createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, handleHttp),
      scheme: 'https',
    };
  }

  log('! СЃРµСЂС‚РёС„РёРєР°С‚Р° РЅРµС‚ вЂ” РїРѕРґРЅРёРјР°СЋ http. РЎРґРµР»Р°Р№ `npm run cert`, РёРЅР°С‡Рµ С€РёС„СЂРѕРІР°РЅРёСЏ РЅРµС‚.');
  return { server: createHttpServer(handleHttp), scheme: 'http' };
}

const { server, scheme } = createServer();
attachWebSocket(server);

// РґРµР»СЊС‚С‹ РїРѕР·РёС†РёР№ 20 СЂР°Р· РІ СЃРµРєСѓРЅРґСѓ
setInterval(() => {
  if (clients.size === 0) return;
  const list = [...clients.values()].map(toView);
  const payload = JSON.stringify({ t: MSG.PLAYERS, list });
  for (const client of clients.values()) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(payload);
  }
}, 1000 / TICK.STATE_HZ);

// Р·Р°РїРёСЃСЊ СЃРѕСЃС‚РѕСЏРЅРёСЏ РІ Р±Р°Р·Сѓ: СЂР°Р· РІ СЃРµРєСѓРЅРґСѓ
setInterval(() => {
  for (const client of clients.values()) {
    store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);
  }
}, TICK.PERSIST_MS);

// СЃС†РµРЅР°СЂРёР№: С‡РµС‚С‹СЂРµ СЂР°Р·Р° РІ СЃРµРєСѓРЅРґСѓ РїСЂРѕРІРµСЂСЏРµРј, РЅРµ РїСЂРёС€Р»Рѕ Р»Рё РІСЂРµРјСЏ РѕС‡РµСЂРµРґРЅРѕРјСѓ С€Р°РіСѓ
setInterval(() => scenario.tick(), 250);

// РґСѓС…РѕС‚Р°: РЅР°С‡РёРЅР°РµС‚СЃСЏ РїРѕСЃР»Рµ С‚РѕРіРѕ, РєР°Рє РЅР°С€Р»Рё СЃРІРµС‚, Рё РїСЂРµРєСЂР°С‰Р°РµС‚СЃСЏ, РєРѕРіРґР° РѕС‚РєСЂС‹Р»Рё С„РѕСЂС‚РѕС‡РєСѓ
let airTick = 0;
setInterval(() => {
  if (!scenario.running || clients.size === 0) return;
  if (store.getFlag('has_light') !== '1') return;
  if (store.getFlag('window_open') === '1') return;

  airTick++;
  if (airTick % 2 === 0 && stats.air > 0) changeStat('air', -1);
}, 1000);

if (!existsSync(join(DIST, 'index.html'))) {
  log('! dist/ РЅРµ СЃРѕР±СЂР°РЅ вЂ” СЃРЅР°С‡Р°Р»Р° `npm run build`');
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push({ name, ip: addr.address });
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  log(`СЃРµСЂРІРµСЂ СЃР»СѓС€Р°РµС‚ ${scheme}://0.0.0.0:${PORT}`);
  if (DEV) {
    log('СЂРµР¶РёРј СЂР°Р·СЂР°Р±РѕС‚РєРё: РєР»РёРµРЅС‚ РѕС‚РєСЂС‹РІР°С‚СЊ С‡РµСЂРµР· Vite (npm run dev:client)');
  } else {
    for (const { name, ip } of lanAddresses()) log(`  ${scheme}://${ip}:${PORT}   (${name})`);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('РѕСЃС‚Р°РЅРѕРІРєР°: СЃРѕС…СЂР°РЅСЏСЋ СЃРѕСЃС‚РѕСЏРЅРёРµ');
    for (const client of clients.values()) {
      store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);
    }
    store.close();
    process.exit(0);
  });
}
