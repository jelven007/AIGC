/** 阻止旧推广和演示服务进入交付；视觉复用仅接受有摘要记录的衍生图。 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const denied = [
  /(?:gitee\.com|github\.com)\/xiaoye66\/shoproai/i,
  /\b(?:f\.playe\.top|shopro\.ai|api\.openai-next\.com|tokendance\.space|ai\.dxkp\.com)\b/i,
  /\bdemo@miaoda\.com\b|\bdemo123456\b/,
];
const roots = ['apps/web/src', 'apps/web/public', 'supabase/functions', 'infra', 'scripts', 'services/mcp', 'docs'];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '__pycache__', '.git'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name), name = relative(root, path);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|py|md|html|svg|json|ya?ml)$/.test(path)) {
      // 门禁自身的拒绝表属于规则，不是运行地址。
      if (path === fileURLToPath(import.meta.url)) continue;
      const content = readFileSync(path, 'utf8');
      if (denied.some(pattern => pattern.test(content))) errors.push(`${name}: 存在已退出的源内容`);
      if (name.startsWith('apps/web/src/') && !name.endsWith('/projectStorage.ts')
        && /['"`]shopro(?:ai)?[:\-]/.test(content)) errors.push(`${name}: 旧浏览器键须经统一迁移模块读取`);
    }
  }
}
for (const name of roots) walk(resolve(root, name));
for (const name of ['image.png', 'shopro.png', 'index', 'shop', 'person', 'covers']) {
  const path = resolve(root, 'apps/web/public', name);
  if (existsSync(path) && (!['index', 'shop', 'person', 'covers'].includes(name) || readdirSync(path).length)) {
    errors.push(`apps/web/public/${name}: 旧演示素材不能进入发布`);
  }
}
const catalogPath = resolve(root, 'apps/web/src/lib/inspirationAssets.json');
if (existsSync(catalogPath)) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const folder = resolve(root, 'apps/web/public/inspiration'), files = new Set();
  if (catalog.length !== 35) errors.push('复用素材清单必须覆盖35张原件');
  for (const item of catalog) {
    if (!/^\/inspiration\/ref-\d{2}\.webp$/.test(item.src) || files.has(item.src)) {
      errors.push(`复用素材路径无效或重复：${item.id}`);
      continue;
    }
    files.add(item.src);
    const path = resolve(root, 'apps/web/public', item.src.slice(1));
    if (!existsSync(path)) { errors.push(`复用素材缺失：${item.id}`); continue; }
    const bytes = readFileSync(path);
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256 || bytes.length !== item.bytes)
      errors.push(`复用素材摘要不一致：${item.id}`);
    if (!/^[a-f0-9]{64}$/.test(item.sourceSha256) || !item.transform || !item.usage || !item.prompt)
      errors.push(`复用素材用途或来源记录缺失：${item.id}`);
  }
  if (existsSync(folder)) for (const name of readdirSync(folder)) {
    if (!files.has(`/inspiration/${name}`)) errors.push(`复用目录存在未登记素材：${name}`);
  }
} else errors.push('复用素材清单缺失：apps/web/src/lib/inspirationAssets.json');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log('来源检查通过：无旧推广/演示服务；35张复用衍生图摘要一致，版权与持久兼容标识保留');
