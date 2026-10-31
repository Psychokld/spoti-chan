import express from 'express';
import jwt from 'jsonwebtoken';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const derive = promisify(scrypt);
const SESSION_MS = 2 * 60 * 60 * 1000;
const VERIFY_MS = 24 * 60 * 60 * 1000;
const COOKIE = 'spoti_session';
const digest = value => createHash('sha256').update(value).digest('hex');
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
const validName = value => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 80;
const failure = (status, message) => Object.assign(new Error(message), { status });

async function passwordHash(password) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function passwordMatches(password, encoded) {
  const [, salt, expected] = (encoded || '').split(':');
  // Missing users still perform the same expensive derivation.
  const hash = await derive(typeof password === 'string' ? password : '', Buffer.from(salt || '00'.repeat(16), 'hex'), 64,
    { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const target = Buffer.from(expected || '00'.repeat(64), 'hex');
  return Boolean(encoded) && hash.length === target.length && timingSafeEqual(hash, target);
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name,
    emailVerified: Boolean(user.email_verified), twoFactorEnabled: Boolean(user.totp_secret),
    createdAt: new Date(user.created_at).toISOString() };
}

/** Mount router at app root. mailer({ to, subject, text, html }) must reject on delivery failure. */
export function createAuthRouter({ dbPath, jwtSecret, encryptionKey, appUrl, mailer, production = false, now = () => Date.now() }) {
  if (typeof jwtSecret !== 'string' || jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
  const key = Buffer.isBuffer(encryptionKey) ? encryptionKey : Buffer.from(encryptionKey || '', 'hex');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes).');
  if (typeof mailer !== 'function') throw new Error('An email transport is required.');
  const origin = new URL(appUrl);
  if (production && origin.protocol !== 'https:') throw new Error('Production APP_URL must use HTTPS.');
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0,
      verify_hash TEXT, verify_expires INTEGER, verify_sent INTEGER,
      totp_secret TEXT, totp_pending TEXT, totp_pending_expires INTEGER,
      totp_last_step INTEGER NOT NULL DEFAULT -1, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_challenges (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS recovery_codes (
      code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, track_id TEXT NOT NULL,
      PRIMARY KEY(user_id, track_id)
    );`);
  const router = express.Router();
  router.use(['/api/auth', '/api/users'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const row = id => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const byEmail = email => db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const transaction = action => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const wrap = action => async (req, res, next) => {
    try { await action(req, res); } catch (error) { next(error); }
  };

  // Bounded, process-local limiter. Reverse proxy must preserve a trustworthy req.ip.
  const attempts = new Map();
  function limit(req, label, count = 30, duration = 10 * 60 * 1000) {
    const current = now();
    for (const [entry, value] of attempts) if (value.until <= current) attempts.delete(entry);
    const id = digest(`${req.ip}|${label}`);
    const value = attempts.get(id) || { count: 0, until: current + duration };
    value.count++;
    if (attempts.size >= 10000 && !attempts.has(id)) throw failure(429, 'Слишком много запросов. Попробуй позже.');
    attempts.set(id, value);
    if (value.count > count) throw failure(429, 'Слишком много попыток. Попробуй через несколько минут.');
  }
  router.use('/api/auth', (req, _res, next) => {
    try { limit(req, 'auth', 60); next(); } catch (error) { next(error); }
  });

  function seal(value, userId) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(userId));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.');
  }
  function unseal(value, userId) {
    const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
  }
  function token(payload, audience, seconds) {
    return jwt.sign({ ...payload, iat: Math.floor(now() / 1000) }, jwtSecret,
      { algorithm: 'HS256', issuer: 'spoti-chan', audience, expiresIn: seconds });
  }
  function decode(value, audience) {
    return jwt.verify(value, jwtSecret, { algorithms: ['HS256'], issuer: 'spoti-chan', audience,
      clockTimestamp: Math.floor(now() / 1000) });
  }
  function clearCookie(res) {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: production, path: '/' });
  }
  function createSession(res, user) {
    const id = randomUUID();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
    db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run(id, user.id, now() + SESSION_MS);
    res.cookie(COOKIE, token({ sub: user.id, jti: id }, 'session', SESSION_MS / 1000),
      { httpOnly: true, sameSite: 'strict', secure: production, path: '/', maxAge: SESSION_MS });
  }
  function revoke(userId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM login_challenges WHERE user_id = ?').run(userId);
  }
  function requireAuth(req, res, next) {
    try {
      const value = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (!value) throw new Error();
      const payload = decode(decodeURIComponent(value), 'session');
      if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') throw new Error();
      const session = db.prepare('SELECT * FROM sessions WHERE id=? AND user_id=? AND expires_at>?').get(payload.jti, payload.sub, now());
      const user = row(payload.sub);
      if (!session || !user || !user.email_verified) throw new Error();
      req.authUser = user; req.authSessionId = session.id; next();
    } catch { clearCookie(res); next(failure(401, 'Войди в аккаунт, чтобы продолжить.')); }
  }
  function totp(secret, email) {
    return new OTPAuth.TOTP({ issuer: 'Spoti-Chan', label: email, algorithm: 'SHA1', digits: 6, period: 30,
      secret: OTPAuth.Secret.fromBase32(secret) });
  }
  function consumeCode(user, code) {
    if (typeof code !== 'string' || code.length > 100 || !user.totp_secret) return false;
    if (/^\d{6}$/u.test(code)) {
      const delta = totp(unseal(user.totp_secret, user.id), user.email).validate({ token: code, timestamp: now(), window: 1 });
      if (delta === null) return false;
      const step = Math.floor(now() / 30000) + delta;
      if (step <= user.totp_last_step) return false;
      return db.prepare('UPDATE users SET totp_last_step=? WHERE id=? AND totp_last_step<?').run(step, user.id, step).changes === 1;
    }
    const codeHash = digest(`${user.id}:${code.trim().toUpperCase()}`);
    return db.prepare('DELETE FROM recovery_codes WHERE user_id=? AND code_hash=?').run(user.id, codeHash).changes === 1;
  }
  async function checkSensitive(req, user) {
    limit(req, `sensitive:${user.id}`, 15);
    if (typeof req.body?.currentPassword !== 'string' || req.body.currentPassword.length > 128 ||
      !await passwordMatches(req.body.currentPassword, user.password_hash)) throw failure(403, 'Текущий пароль неверен.');
    if (user.totp_secret && !consumeCode(user, req.body.code)) throw failure(403, 'Нужен новый код 2FA или неиспользованный резервный код.');
  }
  function recoveryCodes(userId) {
    const codes = Array.from({ length: 8 }, () => randomBytes(10).toString('hex').toUpperCase());
    db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(userId);
    const insert = db.prepare('INSERT INTO recovery_codes(code_hash,user_id) VALUES(?,?)');
    for (const code of codes) insert.run(digest(`${userId}:${code}`), userId);
    return codes;
  }
  async function verification(user) {
    const raw = randomBytes(32).toString('hex');
    db.prepare('UPDATE users SET verify_hash=?,verify_expires=?,verify_sent=? WHERE id=?')
      .run(digest(raw), now() + VERIFY_MS, now(), user.id);
    const link = new URL(appUrl); link.hash = `/verify?token=${raw}`;
    try {
      await mailer({ to: user.email, subject: 'Подтверди почту Spoti-Chan',
        text: `Подтверди почту, открыв ссылку (действует 24 часа):\n${link.href}\nЕсли ты не регистрировался, проигнорируй письмо.`,
        html: `<p>Подтверди почту Spoti-Chan. Ссылка действует 24 часа.</p><p><a href="${link.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Активировать аккаунт</a></p><p>Если ты не регистрировался, проигнорируй письмо.</p>` });
    } catch { throw failure(503, 'Аккаунт сохранён, но письмо отправить не удалось. Попробуй повторную отправку позже.'); }
  }

  router.post('/api/auth/register', wrap(async (req, res) => {
    limit(req, 'register', 10);
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email) || !validPassword(req.body?.password) || !validName(req.body?.displayName))
      throw failure(400, 'Нужны корректная почта, имя (1–80 символов) и пароль (12–128 символов).');
    const hash = await passwordHash(req.body.password);
    if (!byEmail(email)) {
      const id = randomUUID();
      db.prepare('INSERT INTO users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
        .run(id, email, req.body.displayName.trim(), hash, now());
      await verification(row(id));
    }
    res.status(201).json({ message: 'Если адрес ещё не зарегистрирован, письмо активации отправлено. Проверь почту.' });
  }));
  router.post('/api/auth/resend-verification', wrap(async (req, res) => {
    limit(req, 'resend', 8);
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email)) throw failure(400, 'Укажи корректный адрес почты.');
    const user = byEmail(email);
    if (user && !user.email_verified && (!user.verify_sent || now() - user.verify_sent >= 60000)) await verification(user);
    res.json({ message: 'Если аккаунт ожидает активации, письмо отправлено. Между письмами — не менее минуты.' });
  }));
  router.post('/api/auth/verify-email', wrap(async (req, res) => {
    const raw = req.body?.token;
    if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/u.test(raw)) throw failure(400, 'Ссылка активации недействительна.');
    const result = db.prepare('UPDATE users SET email_verified=1,verify_hash=NULL,verify_expires=NULL WHERE verify_hash=? AND verify_expires>? AND email_verified=0')
      .run(digest(raw), now());
    if (result.changes !== 1) throw failure(400, 'Ссылка уже использована или истекла. Запроси новое письмо.');
    res.json({ message: 'Почта подтверждена. Теперь можно войти.' });
  }));
  router.post('/api/auth/login', wrap(async (req, res) => {
    limit(req, 'login', 20);
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email) || typeof req.body?.password !== 'string' || req.body.password.length > 128)
      throw failure(401, 'Неверная почта или пароль.');
    const user = byEmail(email);
    if (!await passwordMatches(req.body.password, user?.password_hash)) throw failure(401, 'Неверная почта или пароль.');
    if (!user.email_verified) throw failure(403, 'Подтверди почту перед входом.');
    if (user.totp_secret) {
      const id = randomUUID();
      db.prepare('DELETE FROM login_challenges WHERE expires_at<=? OR user_id=?').run(now(), user.id);
      db.prepare('INSERT INTO login_challenges(id,user_id,expires_at) VALUES(?,?,?)').run(id, user.id, now() + 300000);
      return res.json({ requiresTwoFactor: true, challengeToken: token({ sub: user.id, jti: id }, 'login-challenge', 300) });
    }
    createSession(res, user); res.json({ user: publicUser(user) });
  }));
  router.post('/api/auth/2fa/login', wrap(async (req, res) => {
    limit(req, 'otp-login', 20);
    let payload;
    try { payload = decode(req.body?.challengeToken, 'login-challenge'); }
    catch { throw failure(401, 'Время входа истекло. Введи почту и пароль заново.'); }
    const challenge = db.prepare('SELECT * FROM login_challenges WHERE id=? AND user_id=? AND expires_at>?')
      .get(payload.jti, payload.sub, now());
    if (!challenge || challenge.attempts >= 5) throw failure(401, 'Время или число попыток входа истекло. Войди заново.');
    db.prepare('UPDATE login_challenges SET attempts=attempts+1 WHERE id=?').run(challenge.id);
    const user = row(challenge.user_id);
    if (!user?.email_verified || !consumeCode(user, req.body?.code)) throw failure(401, 'Код неверен или уже использован.');
    db.prepare('DELETE FROM login_challenges WHERE id=?').run(challenge.id);
    createSession(res, user); res.json({ user: publicUser(user) });
  }));
  router.post('/api/auth/logout', requireAuth, wrap(async (req, res) => {
    db.prepare('DELETE FROM sessions WHERE id=?').run(req.authSessionId); clearCookie(res);
    res.json({ message: 'Выход выполнен.' });
  }));
  router.get('/api/users/me', requireAuth, (req, res) => res.json({ user: publicUser(req.authUser) }));
  router.patch('/api/users/me', requireAuth, wrap(async (req, res) => {
    const user = req.authUser;
    const { displayName, email: inputEmail, newPassword } = req.body || {};
    if (displayName === undefined && inputEmail === undefined && newPassword === undefined) throw failure(400, 'Нет данных для изменения.');
    if (displayName !== undefined && !validName(displayName)) throw failure(400, 'Имя должно содержать 1–80 символов.');
    const email = inputEmail === undefined ? user.email : normalizeEmail(inputEmail);
    if (!validEmail(email)) throw failure(400, 'Укажи корректный адрес почты.');
    if (newPassword !== undefined && !validPassword(newPassword)) throw failure(400, 'Пароль должен содержать 12–128 символов.');
    const sensitive = email !== user.email || newPassword !== undefined;
    if (sensitive) await checkSensitive(req, user);
    if (email !== user.email && byEmail(email)) throw failure(409, 'Этот адрес нельзя использовать.');
    const hash = newPassword === undefined ? user.password_hash : await passwordHash(newPassword);
    transaction(() => {
      db.prepare('UPDATE users SET display_name=?,email=?,password_hash=? WHERE id=?')
        .run(displayName === undefined ? user.display_name : displayName.trim(), email, hash, user.id);
      if (sensitive) revoke(user.id);
      if (email !== user.email) db.prepare('UPDATE users SET email_verified=0,verify_hash=NULL,verify_expires=NULL WHERE id=?').run(user.id);
    });
    if (email !== user.email) {
      clearCookie(res); await verification(row(user.id));
      return res.json({ requiresVerification: true, message: 'Подтверди новую почту и войди заново.' });
    }
    const updated = row(user.id);
    if (sensitive) createSession(res, updated);
    res.json({ user: publicUser(updated) });
  }));
  router.delete('/api/users/me', requireAuth, wrap(async (req, res) => {
    await checkSensitive(req, req.authUser);
    db.prepare('DELETE FROM users WHERE id=?').run(req.authUser.id); clearCookie(res);
    res.json({ message: 'Аккаунт и связанные данные удалены.' });
  }));
  router.post('/api/auth/2fa/setup', requireAuth, wrap(async (req, res) => {
    if (req.authUser.totp_secret) throw failure(409, '2FA уже включена.');
    await checkSensitive(req, req.authUser);
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const qrCodeDataUrl = await QRCode.toDataURL(totp(secret, req.authUser.email).toString(), { width: 256, margin: 2 });
    db.prepare('UPDATE users SET totp_pending=?,totp_pending_expires=? WHERE id=?')
      .run(seal(secret, req.authUser.id), now() + 600000, req.authUser.id);
    res.json({ secret, qrCodeDataUrl });
  }));
  router.post('/api/auth/2fa/enable', requireAuth, wrap(async (req, res) => {
    limit(req, `enable:${req.authUser.id}`, 10);
    const user = req.authUser;
    if (user.totp_secret || !user.totp_pending || user.totp_pending_expires <= now()) throw failure(400, 'Начни настройку 2FA заново.');
    const code = req.body?.code;
    if (typeof code !== 'string' || !/^\d{6}$/u.test(code)) throw failure(400, 'Введи шестизначный код.');
    const delta = totp(unseal(user.totp_pending, user.id), user.email).validate({ token: code, timestamp: now(), window: 1 });
    if (delta === null) throw failure(400, 'Код 2FA неверен.');
    const codes = transaction(() => {
      db.prepare('UPDATE users SET totp_secret=totp_pending,totp_pending=NULL,totp_pending_expires=NULL,totp_last_step=? WHERE id=?')
        .run(Math.floor(now() / 30000) + delta, user.id);
      revoke(user.id); return recoveryCodes(user.id);
    });
    const updated = row(user.id); createSession(res, updated);
    res.json({ user: publicUser(updated), recoveryCodes: codes });
  }));
  router.post('/api/auth/2fa/disable', requireAuth, wrap(async (req, res) => {
    if (!req.authUser.totp_secret) throw failure(409, '2FA не включена.');
    await checkSensitive(req, req.authUser);
    transaction(() => {
      db.prepare('UPDATE users SET totp_secret=NULL,totp_pending=NULL,totp_pending_expires=NULL,totp_last_step=-1 WHERE id=?').run(req.authUser.id);
      db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(req.authUser.id); revoke(req.authUser.id);
    });
    const updated = row(req.authUser.id); createSession(res, updated); res.json({ user: publicUser(updated) });
  }));
  router.post('/api/auth/2fa/recovery-codes', requireAuth, wrap(async (req, res) => {
    if (!req.authUser.totp_secret) throw failure(409, 'Сначала включи 2FA.');
    await checkSensitive(req, req.authUser);
    res.json({ recoveryCodes: transaction(() => recoveryCodes(req.authUser.id)) });
  }));
  const getFavoriteIds = userId => db.prepare('SELECT track_id FROM favorites WHERE user_id=? ORDER BY rowid').all(userId).map(item => item.track_id);
  router.get('/api/users/me/favorites', requireAuth, (req, res) => res.json({ trackIds: getFavoriteIds(req.authUser.id) }));
  router.put('/api/users/me/favorites', requireAuth, wrap(async (req, res) => {
    const ids = req.body?.trackIds;
    if (!Array.isArray(ids) || ids.length > 500 || !ids.every(id => typeof id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/u.test(id)))
      throw failure(400, 'Избранное должно содержать до 500 корректных идентификаторов треков.');
    transaction(() => {
      db.prepare('DELETE FROM favorites WHERE user_id=?').run(req.authUser.id);
      const insert = db.prepare('INSERT INTO favorites(user_id,track_id) VALUES(?,?)');
      for (const id of new Set(ids)) insert.run(req.authUser.id, id);
    });
    res.json({ trackIds: getFavoriteIds(req.authUser.id) });
  }));
  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status === 429) res.set('Retry-After', '600');
    res.status(status).json({ error: status === 500 ? 'Ошибка аккаунта. Попробуй позже.' : error.message });
  });
  return { router, requireAuth, getFavoriteIds, close: () => db.close() };
}
