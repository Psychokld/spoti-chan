import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { createAuthRouter } from './auth/index.js';
import { readConfig } from './config.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('integrated app rejects foreign origins and malformed JSON, then supports account CRUD', async t => {
  const messages = [];
  const auth = createAuthRouter({ dbPath: ':memory:', jwtSecret: 'x'.repeat(48), encryptionKey: 'a'.repeat(64),
    appUrl: 'http://localhost:3001', mailer: async message => messages.push(message) });
  const app = createApp({ auth, music: { status: { catalog: 'test', finder: 'test' },
    catalog: async () => [], find: async () => ({ mode: 'demo-tags', tracks: [] }), recommend: async () => [] } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); auth.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function request(path, body, method = 'POST', headers = {}) {
    const result = await fetch(`${base}${path}`, { method,
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001', Cookie: cookie, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (result.headers.get('set-cookie')) cookie = result.headers.get('set-cookie').split(';')[0];
    return { status: result.status, data: await result.json(), headers: result.headers };
  }
  const registration = { email: 'integration@example.com', password: 'IntegrationPassword123!', displayName: 'Integration' };
  assert.equal((await request('/api/auth/register', registration, 'POST', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal(messages.length, 0);
  assert.equal((await request('/api/auth/register', registration, 'POST', { 'Content-Type': 'text/plain' })).status, 415);
  const malformed = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /Некорректное/u);
  assert.equal((await request('/api/auth/register', null)).status, 400);
  assert.equal((await request('/api/auth/register', { ...registration, password: 'x'.repeat(9000) })).status, 413);
  assert.equal((await request('/api/users/me', undefined, 'GET')).status, 401);
  assert.equal((await request('/api/auth/register', registration)).status, 201);
  assert.equal(messages.length, 1);
  const token = messages[0].text.match(/token=([a-f0-9]{64})/u)[1];
  assert.equal((await request('/api/auth/verify-email', { token })).status, 200);
  const login = await request('/api/auth/login', registration);
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.match(login.headers.get('set-cookie'), /HttpOnly/u);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/u);
  const me = await request('/api/users/me', undefined, 'GET');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, registration.email);
  assert.ok(!JSON.stringify(me.data).includes(registration.password));
  assert.equal((await request('/api/users/me', { displayName: 'New name' }, 'PATCH', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('/api/users/me', { displayName: 'New name' }, 'PATCH')).data.user.displayName, 'New name');
  assert.equal((await request('/api/users/some-other-id', undefined, 'GET')).status, 404);
  assert.equal((await request('/api/users/me/favorites', { trackIds: ['1', '2'] }, 'PUT')).status, 200);
  assert.deepEqual((await request('/api/users/me/favorites', undefined, 'GET')).data.trackIds, ['1', '2']);
  assert.equal((await request('/api/tracks', undefined, 'GET')).status, 200);
  assert.equal((await request('/api/finder', { description: 'rock' })).status, 200);
  assert.equal((await request('/api/users/me', { currentPassword: registration.password }, 'DELETE')).status, 200);
  assert.equal((await request('/api/users/me', undefined, 'GET')).status, 401);
});

test('development secrets persist while production refuses missing keys or SMTP', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'spoti-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = readConfig({ DATA_DIR: directory });
  assert.equal(config.encryptionKey.length, 64);
  const again = readConfig({ DATA_DIR: directory });
  assert.equal(config.jwtSecret, again.jwtSecret);
  assert.equal(config.encryptionKey, again.encryptionKey);
  assert.match(await readFile(join(directory, 'development-secrets.json'), 'utf8'), /encryptionKey/u);
  assert.throws(() => readConfig({ NODE_ENV: 'production', DATA_DIR: directory }), /обязательны/u);
  const production = { NODE_ENV: 'production', DATA_DIR: directory, JWT_SECRET: 'p'.repeat(48), DATA_ENCRYPTION_KEY: 'b'.repeat(64), APP_URL: 'https://music.example.com' };
  assert.throws(() => readConfig(production), /SMTP/u);
  assert.throws(() => readConfig({ ...production, APP_URL: 'http://music.example.com' }), /HTTPS/u);
});
