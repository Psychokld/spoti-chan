import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as OTPAuth from 'otpauth';
import { createAuthRouter } from './auth/index.js';

const password = 'A sufficiently long password 123!';
const email = 'student@example.com';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'spoti-auth-'));
  let currentTime = Date.now();
  const messages = [];
  const dbPath = join(directory, 'auth.sqlite');
  const auth = createAuthRouter({ dbPath, jwtSecret: 's'.repeat(48), encryptionKey: 'a'.repeat(64),
    appUrl: 'http://localhost:3001', mailer: async message => messages.push(message), now: () => currentTime, ...options });
  const app = express(); app.use(express.json()); app.use(auth.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); auth.close(); await rm(directory, { recursive: true, force: true }); });
  let cookie = '';
  async function request(path, body, method = 'POST', useCookie = true) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(useCookie && cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json(), setCookie };
  }
  const verifyToken = () => messages.at(-1).text.match(/token=([a-f0-9]{64})/u)[1];
  const register = () => request('/api/auth/register', { email, password, displayName: 'Student' });
  const activate = () => request('/api/auth/verify-email', { token: verifyToken() });
  const login = () => request('/api/auth/login', { email, password });
  return { request, messages, dbPath, register, activate, login, verifyToken,
    advance: duration => { currentTime += duration; }, now: () => currentTime,
    getCookie: () => cookie, setCookie: value => { cookie = value; } };
}

test('registration, one-use email activation, own-profile CRUD and session revocation', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/users/me', undefined, 'GET')).status, 401);
  assert.equal((await f.request('/api/auth/register', { email, password: 'short', displayName: 'Student' })).status, 400);
  assert.equal((await f.register()).status, 201);
  assert.equal(f.messages.length, 1);
  const stored = new DatabaseSync(f.dbPath);
  const record = stored.prepare('SELECT * FROM users WHERE email=?').get(email);
  assert.match(record.password_hash, /^scrypt:/u);
  assert.ok(!record.password_hash.includes(password));
  assert.notEqual(record.verify_hash, f.verifyToken());
  stored.close();
  assert.equal((await f.login()).status, 403);
  assert.equal((await f.request('/api/auth/verify-email', { token: 'f'.repeat(64) })).status, 400);
  assert.equal((await f.activate()).status, 200);
  assert.equal((await f.activate()).status, 400);
  const login = await f.login();
  assert.equal(login.status, 200);
  assert.equal(login.data.user.email, email);
  assert.match(login.setCookie, /HttpOnly/u);
  assert.match(login.setCookie, /SameSite=Strict/u);
  assert.ok(!('password_hash' in login.data.user));
  const firstCookie = f.getCookie();
  const duplicate = await f.register();
  assert.equal(duplicate.status, 201);
  assert.equal(f.messages.length, 1);
  assert.equal((await f.request('/api/users/me', { displayName: 'Updated', id: 'somebody-else' }, 'PATCH')).data.user.displayName, 'Updated');
  assert.equal((await f.request('/api/users/me/favorites', { trackIds: ['1', 'jamendo:23', '1'] }, 'PUT')).status, 200);
  assert.deepEqual((await f.request('/api/users/me/favorites', undefined, 'GET')).data.trackIds, ['1', 'jamendo:23']);
  assert.equal((await f.request('/api/users/me/favorites', { trackIds: ['<script>'] }, 'PUT')).status, 400);
  assert.equal((await f.request('/api/users/me', { newPassword: `${password}X`, currentPassword: 'wrong' }, 'PATCH')).status, 403);
  const changed = await f.request('/api/users/me', { newPassword: `${password}X`, currentPassword: password }, 'PATCH');
  assert.equal(changed.status, 200);
  const updatedCookie = f.getCookie();
  f.setCookie(firstCookie);
  assert.equal((await f.request('/api/users/me', undefined, 'GET')).status, 401);
  f.setCookie(updatedCookie);
  assert.equal((await f.request('/api/auth/logout')).status, 200);
  f.setCookie(updatedCookie);
  assert.equal((await f.request('/api/users/me', undefined, 'GET')).status, 401);
  assert.equal((await f.login()).status, 401);
  assert.equal((await f.request('/api/auth/login', { email, password: `${password}X` })).status, 200);
  assert.equal((await f.request('/api/users/me', { currentPassword: `${password}X` }, 'DELETE')).status, 200);
  assert.equal((await f.request('/api/auth/login', { email, password: `${password}X` })).status, 401);
  const db = new DatabaseSync(f.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM favorites').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  db.close();
});

test('TOTP enrollment, challenge-only login, replay rejection and one-use recovery codes', async t => {
  const f = await fixture(t);
  await f.register(); await f.activate(); await f.login();
  const originalCookie = f.getCookie();
  const setup = await f.request('/api/auth/2fa/setup', { currentPassword: password });
  assert.equal(setup.status, 200);
  assert.match(setup.data.qrCodeDataUrl, /^data:image\/png;base64,/u);
  const encryptedDb = new DatabaseSync(f.dbPath);
  const pending = encryptedDb.prepare('SELECT totp_pending FROM users WHERE email=?').get(email).totp_pending;
  assert.ok(!pending.includes(setup.data.secret));
  assert.equal(pending.split('.').length, 3);
  encryptedDb.close();
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.data.secret), period: 30, digits: 6, algorithm: 'SHA1' });
  const code = () => totp.generate({ timestamp: f.now() });
  assert.equal((await f.request('/api/auth/2fa/enable', { code: 'invalid' })).status, 400);
  const enabled = await f.request('/api/auth/2fa/enable', { code: code() });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.user.twoFactorEnabled, true);
  assert.equal(enabled.data.recoveryCodes.length, 8);
  const enrolledCookie = f.getCookie();
  f.setCookie(originalCookie);
  assert.equal((await f.request('/api/users/me', undefined, 'GET')).status, 401);
  const login = await f.login();
  assert.equal(login.data.requiresTwoFactor, true);
  assert.equal(login.setCookie, null);
  assert.equal((await f.request('/api/users/me', undefined, 'GET')).status, 401);
  assert.equal((await f.request('/api/auth/2fa/login', { challengeToken: login.data.challengeToken, code: code() })).status, 401);
  f.advance(30000);
  const completed = await f.request('/api/auth/2fa/login', { challengeToken: login.data.challengeToken, code: code() });
  assert.equal(completed.status, 200);
  assert.equal((await f.request('/api/auth/2fa/login', { challengeToken: login.data.challengeToken, code: code() })).status, 401);
  f.setCookie(enrolledCookie);
  assert.equal((await f.request('/api/auth/2fa/disable', { currentPassword: password, code: code() })).status, 403);
  const recovery = enabled.data.recoveryCodes[0];
  assert.equal((await f.request('/api/auth/2fa/recovery-codes', { currentPassword: password, code: recovery })).status, 200);
  assert.equal((await f.request('/api/auth/2fa/recovery-codes', { currentPassword: password, code: recovery })).status, 403);
  f.advance(30000);
  assert.equal((await f.request('/api/auth/2fa/disable', { currentPassword: password, code: code() })).data.user.twoFactorEnabled, false);
  const db = new DatabaseSync(f.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recovery_codes').get().count, 0);
  db.close();
});

test('expired activation/session, email change reactivation and failed email delivery', async t => {
  const f = await fixture(t);
  await f.register();
  const expired = f.verifyToken();
  f.advance(24 * 60 * 60 * 1000 + 1);
  assert.equal((await f.request('/api/auth/verify-email', { token: expired })).status, 400);
  await f.request('/api/auth/resend-verification', { email }); await f.activate(); await f.login();
  const session = f.getCookie();
  const changed = await f.request('/api/users/me', { email: 'new@example.com', currentPassword: password }, 'PATCH');
  assert.equal(changed.data.requiresVerification, true);
  f.setCookie(session);
  assert.equal((await f.request('/api/users/me', undefined, 'GET')).status, 401);
  assert.equal((await f.request('/api/auth/login', { email: 'new@example.com', password })).status, 403);
  await f.activate();
  await f.request('/api/auth/login', { email: 'new@example.com', password });
  f.advance(2 * 60 * 60 * 1000 + 1000);
  assert.equal((await f.request('/api/users/me', undefined, 'GET')).status, 401);
  const failing = await fixture(t, { mailer: async () => { throw new Error('SMTP offline'); } });
  assert.equal((await failing.register()).status, 503);
  assert.equal((await failing.login()).status, 403);
});

test('auth limiter blocks repeated password guessing', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 20; i++) assert.equal((await f.request('/api/auth/login', { email, password: 'wrong' })).status, 401);
  assert.equal((await f.request('/api/auth/login', { email, password: 'wrong' })).status, 429);
});
