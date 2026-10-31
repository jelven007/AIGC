/** 冻结SDK依赖在发布时打包；运行时无需npm/jsr/远程模块仓库。 */
import { builtinModules, createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2];
if (!output) throw new Error('需要独立输出目录');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const payments = createRequire(resolve(root, 'deploy/self-hosted/edge-dependencies/package.json'));
const manifest = JSON.parse(await readFile(resolve(root, 'deploy/volcengine/manifest.json')));
const receipts = [];
for (const { name } of manifest.functions) {
  const directory = resolve(output, name);
  await mkdir(directory, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, 'supabase/functions', name, 'index.ts')],
    outfile: resolve(directory, 'index.ts'), bundle: true, format: 'esm',
    platform: 'node', target: ['es2022', 'node22'], minify: false, metafile: true,
    banner: { js: 'import { createRequire as shoproCreateRequire } from "node:module"; import process from "node:process"; import { Buffer } from "node:buffer"; const require = shoproCreateRequire(import.meta.url); const global = globalThis;' },
    plugins: [{
      name: 'frozen-selfhost-dependencies',
      setup(build) {
        build.onResolve({ filter: /^npm:/ }, ({ path }) => {
          if (path === 'npm:@supabase/supabase-js@2') return { path: resolve(root, 'deploy/self-hosted/supabase-client.ts') };
          if (path === 'npm:@supabase/supabase-js@2.103.1') return { path: require.resolve('@supabase/supabase-js').replace(/\.cjs$/, '.mjs') };
          if (path === 'npm:alipay-sdk@4.14.0') return { path: payments.resolve('alipay-sdk') };
          throw new Error(`未冻结依赖：${path}`);
        });
        build.onResolve({ filter: /^(?:node:)?[\w/]+$/ }, ({ path }) =>
          path.startsWith('node:') ? { path, external: true }
            : builtinModules.includes(path) ? { path: `node:${path}`, external: true } : undefined);
      },
    }],
  });
  const external = Object.values(result.metafile.outputs).flatMap(value => value.imports).filter(value => value.external);
  if (external.some(value => !value.path.startsWith('node:'))) throw new Error(`${name}存在远程依赖：${JSON.stringify(external)}`);
  const bytes = await readFile(resolve(directory, 'index.ts'));
  receipts.push({ name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ functions: receipts }, null, 2));
console.log(JSON.stringify({ edge_bundles: receipts.length, remote_modules: 0 }));
