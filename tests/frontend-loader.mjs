import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** Transpile real frontend modules; replace only SDK/environment at the boundary. */
export async function loadFrontend(entry, suite, substitutes = {}) {
  const directory = resolve(tmpdir(), `shoproai-frontend-${suite}`);
  mkdirSync(directory, { recursive: true });
  const compiled = new Map();
  const replacements = {
    'src/db/supabase.ts': 'export const supabase = globalThis.__frontendDB;',
    'src/lib/backendConfig.ts': `export const backendUrl = 'https://db.example';
      export const backendAnonKey = 'anon';
      export const edgeFunctionUrl = name => backendUrl + '/functions/v1/' + name;`,
    ...substitutes,
  };
  function compile(file) {
    const absolute = resolve(file);
    if (compiled.has(absolute)) return compiled.get(absolute);
    const output = resolve(directory, `${compiled.size}.mjs`);
    compiled.set(absolute, output);
    const replacement = Object.entries(replacements).find(([name]) => resolve(name) === absolute)?.[1];
    const source = ts.transpileModule(replacement ?? readFileSync(absolute, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText.replace(/(['"])(@\/[^'"]+|\.\.?\/[^'"]+)\1/g, (_, quote, specifier) => {
      let dependency = specifier.startsWith('@/') ? resolve('src', specifier.slice(2)) : resolve(dirname(absolute), specifier);
      if (!/\.(?:tsx|ts)$/.test(dependency)) dependency += '.ts';
      return `${quote}${pathToFileURL(compile(dependency)).href}${quote}`;
    });
    writeFileSync(output, source);
    return output;
  }
  return import(pathToFileURL(compile(entry)).href);
}
