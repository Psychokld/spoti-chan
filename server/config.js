import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const dataDir = path.resolve(env.DATA_DIR || '.data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let secrets = {};
  if (!production && (!env.JWT_SECRET || !env.DATA_ENCRYPTION_KEY)) {
    const file = path.join(dataDir, 'development-secrets.json');
    try { secrets = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      secrets = { jwtSecret: randomBytes(48).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
      writeFileSync(file, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' });
    }
  }
  const jwtSecret = env.JWT_SECRET || secrets.jwtSecret;
  const encryptionKey = env.DATA_ENCRYPTION_KEY || secrets.encryptionKey;
  if (typeof jwtSecret !== 'string' || jwtSecret.length < 32 || !/^[a-fA-F0-9]{64}$/.test(encryptionKey || '')) throw new Error('JWT_SECRET (32+ символа) и DATA_ENCRYPTION_KEY (64 hex) обязательны.');
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный PORT.');
  const appUrl = new URL(env.APP_URL || `http://localhost:${port}`);
  if (!['http:', 'https:'].includes(appUrl.protocol) || (production && appUrl.protocol !== 'https:')) throw new Error('Production требует APP_URL с HTTPS.');
  if (production && (!env.APP_URL || !env.SMTP_HOST || !env.SMTP_FROM)) throw new Error('Production требует APP_URL, SMTP_HOST и SMTP_FROM.');
  return { production, dataDir, jwtSecret, encryptionKey, port, appUrl: appUrl.origin, dbPath: path.resolve(env.SQLITE_PATH || path.join(dataDir, 'spoti-chan.sqlite')),
    smtp: { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM },
    music: { jamendoClientId: env.JAMENDO_CLIENT_ID, geminiApiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL || 'gemini-3.8-flash' } };
}
