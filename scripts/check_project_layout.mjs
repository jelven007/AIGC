/** 检查实际源码依赖与文档目标；不连接后端，不执行归档脚本。 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..');
const errors = [];
const slash = path => relative(root, path).split(sep).join('/');
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}
const source = walk(resolve(root, 'src')).filter(path => /\.(ts|tsx)$/.test(path));
const contracts = new Set([
  'api-scopes.ts', 'edit-contract.ts', 'image-contract.ts', 'model-catalog.ts',
  'product-contract.ts', 'publish-contract.ts', 'render-effects.ts', 'video-branding.ts',
].map(name => `supabase/functions/_shared/${name}`));
const graph = new Map();
function imports(path) {
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const result = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      result.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}
function localDependency(path, name) {
  const clean = name.split('?')[0];
  if (!clean.startsWith('@/') && !clean.startsWith('.')) return null;
  const target = clean.startsWith('@/') ? resolve(root, 'src', clean.slice(2)) : resolve(dirname(path), clean);
  const choices = [target, ...['.ts', '.tsx', '.mjs', '.js', '.css'].map(ext => target + ext),
    ...['index.ts', 'index.tsx', 'index.mjs', 'index.js'].map(name => resolve(target, name))];
  const found = choices.find(path => existsSync(path) && extname(path));
  if (!found) errors.push(`${slash(path)}: 缺少依赖 ${name}`);
  return found ? slash(found) : null;
}
for (const path of source) {
  const name = slash(path), dependencies = [];
  for (const specifier of imports(path)) {
    const dependency = localDependency(path, specifier);
    if (!dependency) continue;
    dependencies.push(dependency);
    if (/^src\/(?:components|hooks|contexts|api|lib|db|types|services)\//.test(name) &&
      dependency.startsWith('src/pages/')) {
      errors.push(`${name}: 共享层反向依赖页面 ${dependency}`);
    }
    if (/^src\/(?:api|lib|db|types|services)\//.test(name) &&
      /^src\/(?:components|hooks|pages)\//.test(dependency)) {
      errors.push(`${name}: 数据/工具层依赖界面层 ${dependency}`);
    }
    if (!dependency.startsWith('src/') && !contracts.has(dependency)) {
      errors.push(`${name}: 跨运行时依赖未经声明 ${dependency}`);
    }
  }
  graph.set(name, dependencies.filter(name => name.startsWith('src/')));
}
// 声明的跨运行时模块必须保持纯契约，不能间接带入 SDK 或服务端能力。
for (const contract of contracts) {
  const path = resolve(root, contract);
  for (const specifier of imports(path)) {
    const dependency = localDependency(path, specifier);
    if (!dependency || !contracts.has(dependency)) errors.push(`${contract}: 契约依赖非纯模块 ${specifier}`);
  }
  if (/\b(?:Deno|process\.env|fetch|createClient)\b/.test(readFileSync(path, 'utf8'))) {
    errors.push(`${contract}: 契约包含环境或网络能力`);
  }
}
const active = new Set(), done = new Set(), stack = [];
function visit(name) {
  if (active.has(name)) {
    errors.push(`依赖循环: ${[...stack.slice(stack.indexOf(name)), name].join(' → ')}`);
    return;
  }
  if (done.has(name)) return;
  active.add(name); stack.push(name);
  for (const dependency of graph.get(name) || []) visit(dependency);
  stack.pop(); active.delete(name); done.add(name);
}
for (const name of graph.keys()) visit(name);
for (const entry of readdirSync(resolve(root, 'src/pages'), { withFileTypes: true })) {
  if (entry.isFile()) errors.push(`页面须按业务域归组: src/pages/${entry.name}`);
}
for (const directory of ['backend', 'api', 'scratch', 'doc', 'skill-creator']) {
  if (existsSync(resolve(root, directory))) errors.push(`历史目录须归档: ${directory}`);
}
const config = JSON.parse(readFileSync(resolve(root, 'components.json'), 'utf8'));
for (const path of [config.tailwind.config, config.tailwind.css]) {
  if (!existsSync(resolve(root, path))) errors.push(`shadcn 配置目标不存在: ${path}`);
}
const nodeConfig = ts.readConfigFile(resolve(root, 'tsconfig.node.json'), ts.sys.readFile).config;
for (const path of nodeConfig.include) {
  if (!existsSync(resolve(root, path))) errors.push(`Node 类型检查目标不存在: ${path}`);
}
const markdown = ['README.md', 'AGENTS.md'].map(path => resolve(root, path));
for (const directory of ['docs', 'mcp', 'tools']) {
  markdown.push(...walk(resolve(root, directory)).filter(path => path.endsWith('.md')));
}
const lifecycle = JSON.parse(readFileSync(resolve(root, 'docs/lifecycle.json'), 'utf8'));
for (const document of lifecycle.documents) {
  if (!document.owner || !document.verified_on || !document.review_trigger || !document.sources.length) {
    errors.push(`文档生命周期信息缺失: ${document.path}`);
  }
  for (const path of [document.path, ...document.sources]) {
    if (!existsSync(resolve(root, path))) errors.push(`文档权威来源不存在: ${path}`);
  }
}
let links = 0;
for (const path of markdown) {
  for (const match of readFileSync(path, 'utf8').matchAll(/\]\(([^()\s]+)\)/g)) {
    const target = match[1];
    if (/^(?:[a-zA-Z][\w+.-]*:|#|\/)/.test(target)) continue;
    links++;
    if (!existsSync(resolve(dirname(path), decodeURIComponent(target.split('#')[0])))) {
      errors.push(`${slash(path)}: 本地文档链接不存在 ${target}`);
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`目录检查通过：${source.length} 源码模块，${contracts.size} 纯契约，${markdown.length} 文档，${links} 本地链接；零循环/反向依赖`);
}
