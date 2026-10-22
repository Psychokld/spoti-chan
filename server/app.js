import express from 'express';
import { tracks } from './catalog.js';
import { findTracks } from './finder.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/tracks', (_req, res) => res.json({ tracks }));

app.post('/api/finder', (req, res) => {
  const description = req.body?.description;
  if (typeof description !== 'string' || !description.trim() || description.length > 500) {
    return res.status(400).json({ error: 'Описание должно содержать от 1 до 500 символов.' });
  }
  res.json({ mode: 'demo-tags', tracks: findTracks(description.trim()) });
});

app.use((err, _req, res, _next) => {
  const status = err.status === 413 ? 413 : err.status === 400 ? 400 : 500;
  res.status(status).json({ error: status === 500 ? 'Ошибка сервера.' : 'Некорректное тело запроса.' });
});
