import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFrontend } from './frontend-loader.mjs';

test('empty project first edit can undo; new branch discards redo', async () => {
  const { createHistory, changeHistory } = await loadFrontend('apps/web/src/lib/editorHistory.ts', 'editor-history');
  let state = createHistory([]);
  const clip = { id: 'clip', start: 0 };
  state = changeHistory(state, { type: 'edit', update: previous => [...previous, clip] });
  state = changeHistory(state, { type: 'undo' });
  assert.deepEqual(state.present, []);
  state = changeHistory(state, { type: 'redo' });
  assert.equal(state.present[0], clip);
  state = changeHistory(state, { type: 'undo' });
  state = changeHistory(state, { type: 'edit', update: () => [{ id: 'other', start: 0 }] });
  assert.equal(changeHistory(state, { type: 'redo' }), state);
});

test('history is bounded, shares untouched clips, skips unchanged arrays, reset clears old project', async () => {
  const { createHistory, changeHistory, HISTORY_LIMIT } = await loadFrontend('apps/web/src/lib/editorHistory.ts', 'editor-history');
  const untouched = { id: 'still' };
  let state = createHistory([untouched, { id: 'moving', start: 0 }]);
  for (let n = 1; n <= 500; n++) state = changeHistory(state, {
    type: 'edit', update: previous => [previous[0], { ...previous[1], start: n }],
  });
  assert.equal(state.past.length, HISTORY_LIMIT);
  assert.ok(state.past.every(snapshot => snapshot[0] === untouched));
  assert.equal(changeHistory(state, { type: 'edit', update: previous => [...previous] }), state);
  const reset = changeHistory(state, { type: 'reset', value: [] });
  assert.equal(reset.past.length, 0);
  assert.equal(changeHistory(reset, { type: 'undo' }), reset);
});

test('one continuous slider gesture produces one undo entry; cancelled gesture preserves redo', async () => {
  const { createHistory, changeHistory } = await loadFrontend('apps/web/src/lib/editorHistory.ts', 'editor-history');
  let state = createHistory([{ id: 'clip', scale: 100 }]);
  state = changeHistory(state, { type: 'begin' });
  for (let scale = 101; scale < 200; scale++) state = changeHistory(state, {
    type: 'edit', update: previous => [{ ...previous[0], scale }],
  });
  assert.equal(state.past.length, 0);
  state = changeHistory(state, { type: 'commit' });
  assert.equal(state.past.length, 1);
  state = changeHistory(state, { type: 'undo' });
  assert.equal(state.present[0].scale, 100);
  state = changeHistory(state, { type: 'begin' });
  state = changeHistory(state, { type: 'edit', update: () => [{ id: 'clip', scale: 150 }] });
  state = changeHistory(state, { type: 'cancel' });
  assert.equal(changeHistory(state, { type: 'redo' }).present[0].scale, 199);
});

let current = 'owner';
globalThis.__frontendDB = { auth: { getSession: async () => ({
  data: { session: { access_token: `${current}-jwt`, user: { id: current } } }, error: null,
}) } };

test('editor save uses original JWT, canonical media and verifies returned row ownership', async () => {
  const { saveEditorProject } = await loadFrontend('apps/web/src/api/editorProjects.ts', 'editor-projects');
  current = 'owner';
  let outgoing;
  globalThis.fetch = async (url, init) => {
    outgoing = { url, init };
    return new Response(JSON.stringify([{ id: 'project', user_id: 'owner' }]), { headers: { 'content-type': 'application/json' } });
  };
  assert.equal(await saveEditorProject('owner', 'project', { title: '剪辑', style_data: {
    tracks: [{ url: 'https://db.example/storage/v1/object/sign/materials/owner/a.mp4?token=secret' }],
  } }), 'project');
  assert.equal(outgoing.init.headers.Authorization, 'Bearer owner-jwt');
  assert.ok(outgoing.url.includes('user_id=eq.owner'));
  assert.equal(outgoing.init.method, 'PATCH');
  assert.equal(JSON.parse(outgoing.init.body).style_data.tracks[0].url,
    'https://db.example/storage/v1/object/authenticated/materials/owner/a.mp4');
  globalThis.fetch = async () => new Response('[]');
  await assert.rejects(saveEditorProject('owner', 'project', {}), /工程.*不存在|无权/);
});

test('late editor response cannot be applied under another account, aborted read makes zero calls', async () => {
  const { loadEditorProject } = await loadFrontend('apps/web/src/api/editorProjects.ts', 'editor-projects');
  current = 'owner';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++; current = 'other';
    return new Response(JSON.stringify([{ id: 'project', user_id: 'owner' }]));
  };
  await assert.rejects(loadEditorProject('owner', 'project'), /账号或会话已切换/);
  current = 'owner';
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadEditorProject('owner', 'project', controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('editor writes serialize snapshots and failed write does not strand subsequent save', async () => {
  const { EditorSaveQueue } = await loadFrontend('apps/web/src/lib/editorPersistence.ts', 'editor-persistence');
  const queue = new EditorSaveQueue(), trace = [];
  let release;
  const first = queue.run(async () => { trace.push('start-1'); await new Promise(resolve => { release = resolve; }); trace.push('end-1'); throw Error('lost'); });
  const failed = assert.rejects(first, /lost/);
  const second = queue.run(async () => { trace.push('start-2'); return 'original-id'; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(trace, ['start-1']);
  release();
  await failed;
  assert.equal(await second, 'original-id');
  assert.deepEqual(trace, ['start-1', 'end-1', 'start-2']);
});

test('matching empty local draft restores without database overwrite; broken storage stops restoration', async () => {
  const { restoreEditorSnapshot } = await loadFrontend('apps/web/src/lib/editorPersistence.ts', 'editor-persistence');
  current = 'owner';
  const saved = JSON.stringify({ importId: 'project', projectTitle: '本地空工程', tracks: [], duration: 5 });
  globalThis.localStorage = { getItem: () => saved };
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('must not fetch'); };
  const snapshot = await restoreEditorSnapshot('owner', 'project');
  assert.equal(snapshot.projectTitle, '本地空工程');
  assert.deepEqual(snapshot.tracks, []);
  assert.equal(calls, 0);
  globalThis.localStorage.getItem = () => '{broken';
  await assert.rejects(restoreEditorSnapshot('owner', 'project'), /草稿.*读取失败/);
  assert.equal(calls, 0);
});

test('leaving recording before permission resolves stops late microphone stream', async () => {
  const { AudioRecorder } = await loadFrontend('apps/web/src/lib/audioRecorder.ts', 'recorder-cleanup');
  let allow, stopped = 0;
  globalThis.window = {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: () => new Promise(resolve => { allow = resolve; }) },
  } });
  const recorder = new AudioRecorder();
  const starting = recorder.start();
  recorder.cancel();
  allow({ getTracks: () => [{ stop: () => stopped++ }] });
  await assert.rejects(starting, /录音已取消/);
  assert.equal(stopped, 1);
});

test('voice transcription with a captured owner cannot start under a switched account', async () => {
  const { transcribeAudio } = await loadFrontend('apps/web/src/services/audio/index.ts', 'editor-voice-owner');
  current = 'other';
  globalThis.localStorage = { getItem: () => null };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  await assert.rejects(transcribeAudio({ expectedUserId: 'owner', file: new Blob(['wav'], { type: 'audio/wav' }) }), /账号或会话已切换/);
  assert.equal(calls, 0);
});

test('playback converts trimmed double-speed media to timeline time and clamps ends and pauses', async () => {
  const { editorClockTime } = await loadFrontend('apps/web/src/lib/editorClock.ts', 'editor-clock');
  const video = { currentSrc: 'clip.mp4', readyState: 2, seeking: false, paused: false, currentTime: 5 };
  assert.equal(editorClockTime(10, .02, 30, video, { start: 10, sourceStart: 3, speed: 2 }), 11);
  assert.equal(editorClockTime(10, 1, 30, { ...video, paused: true }), 10.25);
  assert.equal(editorClockTime(29.9, .25, 30, null), 30);
  assert.equal(editorClockTime(0, .01, 30, { ...video, currentTime: 0 }, { start: 0, sourceStart: 3 }), 0);
});

test('lost project create response recovers the same UUID, never resets completed media', async () => {
  const { createEditorProject } = await loadFrontend('apps/web/src/api/editorProjects.ts', 'editor-projects');
  current = 'owner';
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(init.method === 'POST' ? '[]' : '[{"id":"original-uuid","user_id":"owner"}]');
  };
  assert.equal(await createEditorProject('owner', 'original-uuid', { title: '新编辑', status: 'draft',
    video_url: null, materials: [], style_data: { tracks: [] } }), 'original-uuid');
  assert.deepEqual(calls.map(call => call.init.method), ['POST', 'GET', 'PATCH']);
  assert.ok(calls[0].init.headers.Prefer.includes('ignore-duplicates'));
  const update = JSON.parse(calls[2].init.body);
  assert.equal(update.status, undefined); assert.equal(update.video_url, undefined);
  assert.equal(update.title, '新编辑');
});
