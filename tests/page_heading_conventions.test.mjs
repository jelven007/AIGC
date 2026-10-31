/** Guard the user-facing heading convention across all TSX pages and components. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const violations = [];
let headings = 0;
function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : entry.isFile() && path.endsWith('.tsx') ? [path] : [];
  });
}
for (const file of [...walkFiles(resolve(root, 'apps/web/src/pages')), ...walkFiles(resolve(root, 'apps/web/src/components'))]) {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const icons = new Set(['Icon', 'svg', 'LangBadge']);
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'lucide-react')
      for (const element of node.importClause?.namedBindings?.elements || []) icons.add(element.name.text);
  }
  function scan(node, insideHeading = false) {
    const jsx = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    const tag = jsx?.tagName.getText(ast);
    const isHeading = tag && (/^h[1-6]$/.test(tag) || /^(CardTitle|DialogTitle|SheetTitle|AlertDialogTitle)$/.test(tag));
    if (isHeading) headings++;
    if (insideHeading && tag && (icons.has(tag) || /\.(?:Icon|icon)$/.test(tag))) {
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      violations.push(`${relative(root, file)}:${line}: ${tag} inside a heading`);
    }
    ts.forEachChild(node, child => scan(child, insideHeading || isHeading));
  }
  scan(ast);
}
assert.ok(headings > 100, 'The convention guard must inspect the full application');
assert.deepEqual(violations, [], violations.join('\n'));
console.log(`PASS ${headings} page, card and dialog headings contain no icons`);
