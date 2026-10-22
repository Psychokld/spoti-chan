import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './app.js';

test('catalog and description finder API', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(`${url}/api/finder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });

  assert.equal((await (await fetch(`${url}/api/health`)).json()).status, 'ok');
  assert.equal((await (await fetch(`${url}/api/tracks`)).json()).tracks.length, 4);
  const result = await (await post({ description: 'Что-то похожее на Linkin Park, но с женским вокалом' })).json();
  assert.equal(result.mode, 'demo-tags');
  assert.deepEqual(result.tracks.map(track => track.artist), ['Evanescence', 'Within Temptation']);
  assert.ok(result.tracks.every(track => track.vocals === 'female'));
  assert.deepEqual((await (await post({ description: 'джаз' })).json()).tracks, []);
  assert.deepEqual((await (await post({ description: 'dance' })).json()).tracks.map(track => track.artist), ['Daft Punk']);
  assert.deepEqual((await (await post({ description: 'мужской и женский вокал' })).json()).tracks, []);
  for (const description of [undefined, '', '   ', 42, 'x'.repeat(501)]) {
    assert.equal((await post({ description })).status, 400);
  }
  const malformed = await fetch(`${url}/api/finder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
  });
  assert.equal(malformed.status, 400);
  const oversized = await post({ description: 'x'.repeat(9000) });
  assert.equal(oversized.status, 413);
});
