import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestTracks } from './api.js';

test('frontend API accepts tracks and rejects malformed or failed responses', async t => {
  const track = { id: '1', title: 'Going Under', artist: 'Evanescence', vocals: 'female', tags: ['rock'] };
  const fetch = t.mock.method(globalThis, 'fetch');
  fetch.mock.mockImplementation(async () => Response.json({ tracks: [track] }));
  assert.deepEqual(await requestTracks('/api/tracks'), [track]);

  for (const payload of [null, {}, { tracks: [null] }, { tracks: [{ ...track, tags: null }] }]) {
    fetch.mock.mockImplementation(async () => Response.json(payload));
    await assert.rejects(requestTracks('/api/tracks'), /неизвестном формате/);
  }
  fetch.mock.mockImplementation(async () => new Response('<html>Error</html>', { status: 502 }));
  await assert.rejects(requestTracks('/api/tracks'), /неверный ответ/);
  fetch.mock.mockImplementation(async () => Response.json({ error: 'Некорректное описание.' }, { status: 400 }));
  await assert.rejects(requestTracks('/api/finder'), /Некорректное описание/);
  fetch.mock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(requestTracks('/api/tracks'), /Не удалось связаться/);
  fetch.mock.mockImplementation(async () => { throw new DOMException('Aborted', 'AbortError'); });
  await assert.rejects(requestTracks('/api/tracks'), { name: 'AbortError' });
});
