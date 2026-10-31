import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMusicService } from './music.js';

test('demo finder and recommendations use real catalog IDs', async () => {
  const music = createMusicService();
  assert.equal(music.status.catalog, 'demo');
  assert.deepEqual((await music.find('Linkin Park с женским вокалом')).tracks.map(track => track.artist), ['Evanescence', 'Within Temptation']);
  assert.deepEqual((await music.find('джаз')).tracks, []);
  const result = await music.recommend(['1']);
  assert.equal(result[0].id, '3');
  assert.ok(result.every(track => track.id !== '1' && track.matchedTags.length));
});

test('Jamendo response normalizes audio and attribution; filters are sent upstream', async () => {
  let requested;
  const music = createMusicService({ jamendoClientId: 'test-key', fetchImpl: async url => {
    requested = new URL(url);
    return Response.json({ headers: { status: 'success' }, results: [{ id: '42', name: 'Song', artist_name: 'Artist',
      audio: 'https://example.com/song.mp3', shareurl: 'https://jamendo.com/track/42', license_ccurl: 'http://creativecommons.org/licenses/by/3.0/',
      duration: 180, musicinfo: { gender: 'female', tags: { genres: ['rock'] } } }] });
  } });
  const result = await music.find('женский рок');
  assert.equal(requested.searchParams.get('gender'), 'female');
  assert.equal(requested.searchParams.get('fuzzytags'), 'rock');
  assert.equal(result.tracks[0].id, 'jamendo:42');
  assert.equal(result.tracks[0].audioUrl, 'https://example.com/song.mp3');
  assert.match(result.tracks[0].licenseUrl, /^https:/);
});

test('Gemini extracts criteria but cannot invent tracks or audio', async () => {
  const music = createMusicService({ geminiApiKey: 'test-key', fetchImpl: async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ tags: ['metal'], excludedTags: [], vocals: 'female', artist: '' }) }] } }] }) });
  const result = await music.find('тяжёлый звук с женским голосом');
  assert.equal(result.mode, 'gemini-demo');
  assert.equal(result.tracks.length, 2);
  assert.ok(result.tracks.every(track => track.vocals === 'female' && !track.audioUrl));
});

test('provider failures and malformed AI criteria are explicit errors', async () => {
  const broken = createMusicService({ jamendoClientId: 'test', fetchImpl: async () => new Response('', { status: 503 }) });
  await assert.rejects(broken.catalog(), { status: 502 });
  const malformed = createMusicService({ geminiApiKey: 'test', fetchImpl: async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"tags":null}' }] } }] }) });
  await assert.rejects(malformed.find('рок'), { status: 502 });
});
