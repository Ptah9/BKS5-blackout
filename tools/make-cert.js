/**
 * Выпуск самоподписанного сертификата для локальной сети.
 *
 * Без интернета на демо выпускать сертификат негде, поэтому он делается заранее
 * и лежит в certs/. Ключ в git не попадает — .gitignore.
 *
 * Запуск: npm run cert
 * Доверие: tools/trust-cert.ps1 (Windows, текущий пользователь)
 *
 * selfsigned v5 умеет только асинхронно — отсюда await на верхнем уровне.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from 'selfsigned';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const CERT_DIR = join(ROOT, 'certs');

const ips = [];
for (const list of Object.values(networkInterfaces())) {
  for (const addr of list ?? []) {
    if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
  }
}

const altNames = [
  { type: 2, value: 'localhost' },
  { type: 7, ip: '127.0.0.1' },
  ...ips.map((ip) => ({ type: 7, ip })),
];

const notAfterDate = new Date();
notAfterDate.setDate(notAfterDate.getDate() + 365);

const pems = await generate([{ name: 'commonName', value: 'bks5.local' }], {
  algorithm: 'sha256',
  keySize: 2048,
  notBeforeDate: new Date(),
  notAfterDate,
  extensions: [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
  ],
});

mkdirSync(CERT_DIR, { recursive: true });
writeFileSync(join(CERT_DIR, 'key.pem'), pems.private);
writeFileSync(join(CERT_DIR, 'cert.pem'), pems.cert);
writeFileSync(join(CERT_DIR, 'cert.cer'), pems.cert); // то же тело, ради Import-Certificate

console.log('сертификат выпущен:', join(CERT_DIR, 'cert.pem'));
console.log('отпечаток:', pems.fingerprint);
console.log('домены и адреса:');
for (const a of altNames) console.log('  ', a.type === 7 ? a.ip : a.value);
console.log('\nчтобы браузер не ругался: powershell -ExecutionPolicy Bypass -File tools/trust-cert.ps1');
