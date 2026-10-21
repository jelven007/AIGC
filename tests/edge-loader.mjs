import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// 执行真实共享模块；仅替换平台客户端，不替换配置、加密和业务协议。
export async function loadEdge(entry, suite) {
  const directory = resolve(tmpdir(), `shoproai-edge-${suite}`);
  mkdirSync(directory, { recursive: true });
  const compiled = new Map();
  function compile(file) {
    const absolute = resolve(file);
    if (compiled.has(absolute)) return compiled.get(absolute);
    const output = resolve(directory, `${compiled.size}.mjs`);
    compiled.set(absolute, output);
    let source = readFileSync(absolute, 'utf8').replace(
      /import \{ createClient(?:, User)? \} from ['"]npm:@supabase\/supabase-js@2['"];/g,
      'const createClient = (...args) => globalThis.__createClient(...args);');
    source = source.replace(/(['"])(\.\.?\/[^'"]+)\1/g, (_, quote, relative) => {
      const dependency = compile(resolve(dirname(absolute), relative.endsWith('.ts') ? relative : `${relative}.ts`));
      return `${quote}${pathToFileURL(dependency).href}${quote}`;
    });
    writeFileSync(output, ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText);
    return output;
  }
  return import(pathToFileURL(compile(entry)).href);
}
