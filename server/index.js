import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createApp } from './app.js';
import { createAuthRouter } from './auth/index.js';
import { readConfig } from './config.js';
import { createMailer } from './mailer.js';
import { createMusicService } from './music.js';

if (existsSync('.env')) loadEnvFile('.env');
const config = readConfig();
const auth = createAuthRouter({ ...config, mailer: createMailer(config) });
const app = createApp({ ...config, auth, music: createMusicService(config.music), emailDelivery: config.smtp.host ? 'smtp' : 'development-outbox' });
const server = app.listen(config.port, () => {
  console.log(`Spoti-Chan: ${config.appUrl}`);
  if (!config.smtp.host) console.log('Письма в режиме разработки: .data/outbox/ (реальная отправка SMTP не настроена).');
});
function shutdown() { server.close(() => { auth.close(); process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
