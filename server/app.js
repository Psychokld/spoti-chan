import express from 'express';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createMusicService } from './music.js';

export function createApp({ auth, music = createMusicService(), appUrl = 'http://localhost:3001', production = false, emailDelivery = 'development-outbox' } = {}) {
const app = express();
app.disable('x-powered-by');
if (production) app.set('trust proxy', 1);
app.use(helmet({ strictTransportSecurity: production ? undefined : false,
  contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:'], 'media-src': ["'self'", 'https:'], 'upgrade-insecure-requests': production ? [] : null } } }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 200, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуй через минуту.' } }));
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const allowed = new Set([appUrl]);
  if (!production) ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001', 'http://127.0.0.1:3001'].forEach(origin => allowed.add(origin));
  if (req.get('origin') && !allowed.has(req.get('origin'))) return res.status(403).json({ error: 'Запрос с другого сайта запрещён.' });
  if (req.method !== 'DELETE' && !req.is('application/json')) return res.status(415).json({ error: 'Используй JSON.' });
  next();
});
app.use(express.json({ limit: '8kb' }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/status', (_req, res) => res.json({ auth: Boolean(auth), emailDelivery, ...music.status }));
if (auth) app.use(auth.router);
app.get('/api/tracks', async (req, res) => {
  if (req.query.ids !== undefined) {
    if (typeof req.query.ids !== 'string') return res.status(400).json({ error: 'Некорректные идентификаторы.' });
    const ids = req.query.ids.split(',').filter(Boolean);
    if (ids.length > 500 || !ids.every(id => /^[a-zA-Z0-9:_-]{1,100}$/.test(id))) return res.status(400).json({ error: 'Слишком много или некорректные идентификаторы.' });
    return res.json({ tracks: await music.byIds(ids) });
  }
  res.json({ tracks: await music.catalog() });
});

app.post('/api/finder', rateLimit({ windowMs: 60000, limit: 20, message: { error: 'Лимит поиска: попробуй через минуту.' } }), async (req, res) => {
  const description = req.body?.description;
  if (typeof description !== 'string' || !description.trim() || description.length > 500) {
    return res.status(400).json({ error: 'Описание должно содержать от 1 до 500 символов.' });
  }
  res.json(await music.find(description.trim()));
});

app.post('/api/recommendations', async (req, res) => {
  const ids = req.body?.trackIds;
  if (!Array.isArray(ids) || ids.length > 100 || !ids.every(id => typeof id === 'string' && id.length <= 80)) return res.status(400).json({ error: 'Передай до 100 идентификаторов треков.' });
  res.json({ tracks: await music.recommend(ids), mode: 'tag-recommendations' });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'API-маршрут не найден.' }));

// `npm run build` creates the frontend; Express serves it with the same origin.
app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));

app.use((err, _req, res, _next) => {
  const status = [400, 413, 502].includes(err.status) ? err.status : 500;
  res.status(status).json({ error: status === 502 ? err.message : status === 500 ? 'Ошибка сервера.' : 'Некорректное тело запроса.' });
});
return app;
}

export const app = createApp();
