import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import writeExcel from 'write-excel-file/browser';
import { loadFrontend } from './frontend-loader.mjs';
const { excelSheets } = await loadFrontend('src/lib/excelExport.ts', 'excel-export');
const read = bytes => JSON.parse(execFileSync('python3', ['tests/xlsx_reader.py'], { input: bytes, maxBuffer: 16 * 1024 * 1024 }));
test('导出保留中文、数字、空值和长编号，用户公式文本从未成为Excel公式', async () => {
  const sheets = excelSheets([{ name: '授权交易', rows: [{ 标题: '中文商品', 编号: '001234567890123456',
    口播: '=HYPERLINK("https://invalid.example")', ROAS: 2.8, 缺失: null, 标记: false }] }]);
  const bytes = Buffer.from(await (await writeExcel(sheets).toBlob()).arrayBuffer());
  assert.deepEqual(read(bytes)['授权交易'][1], ['中文商品', '001234567890123456',
    '=HYPERLINK("https://invalid.example")', 2.8, null, false]);
});
test('大表五万行保持行列与预算，超限或非法数字在压缩前拒绝', async () => {
  const rows = Array.from({ length: 50000 }, (_, n) => ({ 标题: `商品${n}`, 播放: n, CTR: n / 50000 }));
  const data = read(Buffer.from(await (await writeExcel(excelSheets([{ name: '大表', rows }])).toBlob()).arrayBuffer()));
  assert.equal(data['大表'].length, 50001);
  assert.deepEqual(data['大表'].at(-1), ['商品49999', 49999, 49999 / 50000]);
  assert.throws(() => excelSheets([{ name: '超限', rows: [...rows, rows[0]] }]), /预算|上限/);
  assert.throws(() => excelSheets([{ name: '非法', rows: [{ 数值: Infinity }] }]), /数值/);
});
