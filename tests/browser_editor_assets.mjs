import assert from 'node:assert/strict';
import { creditSnapshot } from './browser_credit_fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend = 'https://ui-fixture.example', base = process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid = '11111111-1111-4111-8111-111111111111', projectId = '22222222-2222-4222-8222-222222222222';
const media = `${backend}/storage/v1/object/authenticated/materials/${uid}/actual.wav`;
const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`,
  refresh_token: 'fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
  user: { id: uid, email: 'local@example.com', app_metadata: {}, user_metadata: {} } };
function wave() {
  const rate = 16000, samples = rate * 2.5, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(Math.round(10000 * Math.sin(index / rate * 2 * Math.PI * 440)), 44 + index * 2);
  return buffer;
}
const audioBytes = wave(), state = { uploads: [], registrations: [], saved: [], error: [], failRegister: true, sharedFail: false,
  materials: [{ id: '33333333-3333-4333-8333-333333333333', user_id: uid, name: '实际授权音轨', type: 'audio', url: media, duration_sec: 2.5 }],
  project: { id: projectId, user_id: uid, title: '真实资源工程', duration: 6, status: 'draft', video_url: null, thumbnail_url: null,
    materials: [], style_data: { duration: 6, tracks: [] } } };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-breakpad',
    '--disable-crash-reporter', `--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', permissions: ['microphone'] });
await context.addInitScript(value => localStorage.setItem('sb-ui-fixture-auth-token', JSON.stringify(value)), session);
await context.route(`${backend}/**`, async route => {
  const req = route.request(), path = new URL(req.url()).pathname;
  let body = {}; try { body = req.postDataJSON() || {}; } catch {}
  let data = [], status = 200, type = 'application/json';
  if (req.method() === 'OPTIONS') data = {};
  else if (path.includes('/auth/')) data = session.user;
  else if (path.includes('/storage/v1/object/sign/') && req.method() === 'POST') {
    data = { signedURL: path.replace('/storage/v1', '') + '?token=fixture' };
  } else if (path.includes('/storage/v1/object/') && req.method() === 'POST') {
    state.uploads.push(req.url());
    data = { Key: path.split('/object/')[1], Id: crypto.randomUUID() };
  } else if (path.includes('/storage/v1/object/')) {
    type = 'audio/wav'; data = audioBytes;
  } else if (path.endsWith('/material-assets')) {
    if (body.action === 'register') {
      state.registrations.push(body);
      let material = state.materials.find(item => item.upload_key === body.request_key);
      if (!material) {
        material = { id: crypto.randomUUID(), user_id: uid, name: body.input.name, type: body.input.type, upload_key: body.request_key,
          url: `${backend}/storage/v1/object/authenticated/materials/${uid}/uploads/${body.request_key}.${body.input.extension}`,
          duration_sec: body.input.duration_sec };
        state.materials.push(material);
      }
      if (state.failRegister) { state.failRegister = false; status = 503; data = { error: '素材登记结果待确认，请恢复原请求' }; }
      else data = { material };
    } else if (body.action === 'shared') {
      if (state.sharedFail) { status = 503; data = { error: '团队共享读取失败' }; }
      else data = { materials: [{ ...state.materials[0], id: 'shared-audio', name: '团队授权音轨' }] };
    } else data = { materials: state.materials.filter(item => !body.type || item.type === body.type), total: state.materials.length };
  } else if (path.endsWith('/production-jobs')) data = body.action === 'edit-prices' ? { costs: { beats: 0, subtitles: 3 } } : { jobs: [] };
  else if (path.includes('/rest/v1/video_projects')) {
    if (req.method() === 'PATCH') { Object.assign(state.project, body); state.saved.push(body); data = [state.project]; }
    else data = new URL(req.url()).searchParams.has('id') ? [state.project] : [];
  } else if (path.includes('/rest/v1/profiles')) data = { id: uid, username: '测试', invite_code: 'TEST' };
  else if (path.endsWith('/rpc/get_my_credits')) data = creditSnapshot(uid, { credits_total: 100, credits_left: 100 });
  await route.fulfill({ status, contentType: type, body: type === 'application/json' ? JSON.stringify(data) : data,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
});
const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => state.error.push(error.message));
try {
  await page.goto(`${base}/video/edit?importId=${projectId}`);
  await page.getByText('真实资源工程', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '资源库 (S)', exact: true }).click();
  await page.getByRole('button', { name: '试听实际授权音轨', exact: true }).click();
  await page.getByRole('button', { name: '停止试听实际授权音轨', exact: true }).waitFor();
  await page.getByRole('button', { name: '停止试听实际授权音轨', exact: true }).click();
  await page.getByRole('button', { name: '添加实际授权音轨到时间轴', exact: true }).click();
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.getByText('剪辑项目已成功保存', { exact: true }).waitFor();
  assert.equal(state.saved.at(-1).style_data.tracks[0].duration, 2.5);
  assert.ok(state.saved.at(-1).style_data.tracks[0].url.includes('actual.wav'));
  state.sharedFail = true;
  await page.getByRole('button', { name: '团队共享', exact: true }).click();
  await page.getByRole('alert').getByText('团队共享读取失败', { exact: true }).waitFor();
  state.sharedFail = false;
  await page.getByRole('button', { name: '刷新资源', exact: true }).click();
  await page.getByRole('button', { name: '添加团队授权音轨到时间轴', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '立即购买', exact: true }).count(), 0);
  console.log('PASS 私有音频真实播放/停止、原文件实际时长、团队共享故障重读和资源库去模拟购买');

  await page.getByRole('button', { name: '媒体库 (M)', exact: true }).click();
  await page.getByRole('button', { name: '上传视频 / 选择已生成视频', exact: true }).click();
  assert.equal(await page.getByLabel('上传授权素材', { exact: true }).isDisabled(), true);
  await page.getByLabel('我已获得这些素材的使用权', { exact: true }).check();
  await page.getByLabel('上传授权素材', { exact: true }).setInputFiles({ name: '原上传.wav', mimeType: 'audio/wav', buffer: audioBytes });
  await page.getByRole('alert').getByText('素材登记结果待确认，请恢复原请求', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '资源库 (S)', exact: true }).click();
  await page.getByRole('button', { name: '恢复原素材上传', exact: true }).click();
  await page.getByText('已恢复1个原素材登记', { exact: true }).waitFor();
  assert.equal(state.uploads.length, 1); assert.equal(new Set(state.registrations.map(item => item.request_key)).size, 1);
  assert.equal(state.registrations[0].input.duration_sec, 2.5); assert.equal(state.registrations[0].input.rights_confirmed, true);
  console.log('PASS 上传使用权确认、登记响应丢失后刷新恢复原UUID、单对象/单素材');

  await page.getByRole('button', { name: '音频编辑 (A)', exact: true }).click();
  await page.getByLabel('音调半音', { exact: true }).fill('5');
  await page.getByLabel('回声强度', { exact: true }).fill('30');
  await page.getByLabel('均衡器1000Hz', { exact: true }).fill('-6');
  await page.getByLabel('机器人调制', { exact: true }).check();
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.getByText('剪辑项目已成功保存', { exact: true }).waitFor();
  const edited = state.saved.at(-1).style_data.tracks.find(item => item.pitch === 5);
  assert.equal(edited.echo, 30); assert.equal(edited.eqBands['1000'], -6); assert.equal(edited.voiceEffect, 'robot');
  await page.reload();
  await page.getByRole('button', { name: '音频编辑 (A)', exact: true }).click();
  await page.getByLabel('编辑音轨', { exact: true }).selectOption(edited.id);
  assert.equal(await page.getByLabel('均衡器1000Hz', { exact: true }).inputValue(), '-6');
  console.log('PASS 所选音轨变调/回声/EQ/机器人即时写入，工程保存后刷新恢复');

  await page.getByRole('button', { name: '录制我的音频', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '开始录音', exact: true }).isDisabled(), true);
  await page.getByLabel('我拥有录音内容及声音的使用权', { exact: true }).check();
  await page.getByRole('button', { name: '开始录音', exact: true }).click();
  await page.getByText('正在录音 1秒', { exact: true }).waitFor();
  await page.getByRole('button', { name: '停止录音', exact: true }).click();
  await page.getByLabel('我的录音预览', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAnimations().every(animation => animation.playState === 'finished'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.volcengine-build/editor-recording-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '保存录音并加入时间轴', exact: true }).click();
  await page.getByText('录音已入库并保存到工程', { exact: true }).waitFor();
  const recording = state.registrations.at(-1);
  assert.equal(recording.input.source, 'recording'); assert.equal(recording.input.type, 'audio');
  assert.ok(recording.input.duration_sec > .1 && recording.input.duration_sec < 10);
  assert.ok(state.saved.at(-1).style_data.tracks.some(item => item.url.includes(recording.request_key)));
  assert.deepEqual(state.error, []);
  console.log('PASS 实际MediaRecorder麦克风流程、停止预览、390px、私有录音上传并保存到工程');
} finally { await context.close(); await browser.close(); }
