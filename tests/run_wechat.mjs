// 在已有 Node 容器中运行同一组 WebCrypto 测试，无需安装 Deno。
import ts from 'typescript';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';

globalThis.crypto ??= webcrypto;
const cases = [];
globalThis.Deno = { test: (name, run) => cases.push({ name, run }) };
const directory = '/tmp/shoproai-wechat-tests';
mkdirSync(directory, { recursive: true });
const helper = readFileSync('supabase/functions/_shared/wechat.ts', 'utf8');
const test = readFileSync('tests/wechat.test.ts', 'utf8')
  .replace('../supabase/functions/_shared/wechat.ts', './wechat.mjs');
for (const [file, source] of [['wechat.mjs', helper], ['test.mjs', test]]) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  writeFileSync(`${directory}/${file}`, compiled.outputText);
}
await import(pathToFileURL(`${directory}/test.mjs`).href);
for (const { name, run } of cases) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`${cases.length} tests passed`);
