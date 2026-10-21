// 计算静态依赖闭包，避免仅报告拆分后的 entry 文件。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
function measure(directory) {
  const manifest = JSON.parse(readFileSync(resolve(directory, '.vite/manifest.json'), 'utf8'));
  const entry = Object.keys(manifest).find(key => manifest[key].isEntry);
  function closure(keys) {
    const seen = new Set(), files = new Set();
    const visit = key => {
      if (seen.has(key) || !manifest[key]) return;
      seen.add(key);
      const row = manifest[key];
      if (row.file.endsWith('.js')) files.add(row.file);
      for (const dep of row.imports || []) visit(dep);
    };
    keys.forEach(visit);
    const content = [...files].map(file => readFileSync(resolve(directory, file)));
    return { files: [...files].sort(), bytes: content.reduce((n, data) => n + data.length, 0),
      gzip_bytes: content.reduce((n, data) => n + gzipSync(data).length, 0) };
  }
  return { bootstrap: closure([entry]), landing: closure([entry, 'src/pages/LandingPage.tsx']),
    credits: closure([entry, 'src/components/layouts/MainLayout.tsx', 'src/pages/CreditsPage.tsx']) };
}
const current = measure(process.argv[2] || 'dist');
if (current.bootstrap.gzip_bytes > 180000) throw new Error('首屏静态JavaScript超出180KB gzip预算');
if (current.bootstrap.files.some(file => /MainLayout|VideoEdit|xlsx|MeasurementDashboard/.test(file))) {
  throw new Error('页面专用模块进入首屏静态依赖');
}
const result = { current };
if (process.argv[3]) result.baseline = measure(process.argv[3]);
console.log(JSON.stringify(result, null, 2));
