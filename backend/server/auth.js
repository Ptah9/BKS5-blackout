/**
 * Пароли и токены.
 *
 * Пароль не хранится нигде: только scrypt-хеш с солью. scrypt выбран потому что
 * он в стандартной библиотеке Node — нативной сборки на машине жюри не будет.
 * Параметры (N=16384, r=8, p=1) — разумный минимум для хакатона: ~60 мс на хеш.
 *
 * Токен сессии хранится в базе как sha256 от себя: если файл базы утечёт,
 * украсть по нему вход нельзя.
 */

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return { hash: key.toString('hex'), salt };
}

export async function verifyPassword(password, salt, expectedHex) {
  const key = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length !== key.length) return false;
  return timingSafeEqual(key, expected);
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
