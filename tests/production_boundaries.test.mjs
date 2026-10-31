import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const editor = readFileSync('src/pages/production/VideoEditPage.tsx', 'utf8');
const home = readFileSync('src/pages/workspace/HomePage.tsx', 'utf8');
assert.ok(editor.includes("from '@/components/production/EditorMediaLibrary'"),
  '媒体库的筛选、上传选择和卡片生命周期应由独立组件承担');
assert.ok(!editor.includes('function MediaLibraryPanel('));
assert.ok(home.includes("from '@/components/production/RecentWorkGrid'"),
  '作品媒体卡片与预览交互应由组件承担');
for (const file of ['EditorMediaLibrary', 'RecentWorkGrid']) {
  assert.ok(!/from ['"][^'"]*pages\//.test(readFileSync(`src/components/production/${file}.tsx`, 'utf8')));
}
console.log('PASS 生产组件独立持有媒体交互且不反向依赖页面');
