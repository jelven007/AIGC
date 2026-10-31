import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadEdge } from './edge-loader.mjs';
import { loadFrontend } from './frontend-loader.mjs';

const forbidden = String.fromCodePoint(0x7535, 0x5546);
const oldBrand = new RegExp('(?<![\\w./:-])' + String.fromCharCode(115, 104, 111, 112, 114, 111)
  + '(?:[\\s_-]*ai)?(?![\\w./:-])', 'i');
const { platformPromptTemplate } = await loadEdge('supabase/functions/_shared/video-branding.ts', 'video-branding');
const { videoTemplateIndustry } = await loadFrontend('apps/web/src/lib/videoTemplates.ts', 'video-template-industry');
const sql = readFileSync('supabase/migrations/00023_ai_service_governance.sql', 'utf8');
const seeds = [...sql.matchAll(/\('([^']+)', 'script', 'douyin',\s*'([^']+)',\s*true, 'generate_script_four_layer', 1, true, '([AB])'\)/g)]
  .map(([, title, content, variant]) => ({ title, content, variant, is_system: true, user_id: null, version: 1, action_key: 'generate_script_four_layer' }));
test('historical built-in seeds use video creation language while preserving original records', () => {
  assert.equal(seeds.length, 2);
  for (const seed of seeds) {
    const before = structuredClone(seed), branded = platformPromptTemplate(seed);
    assert.ok(branded.title.includes('视频脚本'));
    assert.equal(branded.content.includes(forbidden), false);
    assert.deepEqual(seed, before);
    assert.equal(branded.version, seed.version);
    assert.equal(branded.variant, seed.variant);
  }
});
test('private, revised and custom system prompts retain their exact text', () => {
  const seed = seeds[0];
  for (const custom of [
    { ...seed, is_system: false }, { ...seed, user_id: 'owner' }, { ...seed, version: 2 },
    { ...seed, content: seed.content + ' 用户确认的特别要求。' }, { ...seed, title: '自定义创作模板' },
  ]) assert.equal(platformPromptTemplate(custom), custom);
});
test('legacy and current product template categories share the visible filter label', () => {
  assert.equal(videoTemplateIndustry(forbidden), '产品展示');
  assert.equal(videoTemplateIndustry('产品展示'), '产品展示');
  assert.equal(videoTemplateIndustry('教育'), '教育');
});
test('source and project descriptions use the video platform positioning', () => {
  const files = ['apps/web/index.html', 'README.md'];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !['node_modules', '.git', '__pycache__'].includes(entry.name)) walk(path);
      else if (entry.isFile() && /\.(?:tsx?|css|js|mjs|md|html|svg|py|json)$/.test(entry.name)) files.push(path);
    }
  };
  for (const directory of ['apps/web/src', 'supabase/functions', 'apps/web/public', 'docs', 'services/mcp', 'tools/documents']) walk(directory);
  const violations = files.filter(path => readFileSync(path, 'utf8').includes(forbidden));
  assert.deepEqual(violations, []);
  assert.ok(readFileSync('apps/web/index.html', 'utf8').includes('<title>视频生成平台</title>'));
  const descriptionFiles = files.filter(path => /\.md$/.test(path));
  const displayedDescriptions = descriptionFiles.map(path => [path, readFileSync(path, 'utf8')
    .replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
    .replace(/(\[[^\]]*\])\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '')]);
  assert.deepEqual(displayedDescriptions.filter(([, text]) => oldBrand.test(text)).map(([path]) => path), []);
  const sourceFiles = files.filter(path => /\.(tsx?|html|svg|py|js)$/.test(path));
  assert.deepEqual(sourceFiles.filter(path => /Shopro(?:[\s_-]*AI)?/.test(readFileSync(path, 'utf8')
    .replace(/Shopro\\\.mp4/g, 'legacy-media'))), []);
  assert.ok(readFileSync('README.md', 'utf8').includes('以 AI 视频生成为核心'));
});
