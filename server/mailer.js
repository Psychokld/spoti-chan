import nodemailer from 'nodemailer';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export function createMailer(config) {
  if (config.smtp.host) {
    const transport = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port,
      secure: config.smtp.port === 465, requireTLS: config.smtp.port !== 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: 10000, socketTimeout: 15000 });
    return async message => { await transport.sendMail({ ...message, from: config.smtp.from }); };
  }
  if (config.production) throw new Error('SMTP не настроен.');
  return async message => {
    const directory = path.join(config.dataDir, 'outbox');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(message, null, 2), { mode: 0o600 });
  };
}
