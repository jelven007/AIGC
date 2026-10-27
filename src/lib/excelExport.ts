import type { Cell } from 'write-excel-file/browser';

/** 导出仅允许数据单元格；用户字符串从不转成公式，编号不转成数值。 */
export function excelSheets(sheets: { name: string; rows: Record<string, unknown>[] }[]) {
  let cells = 0;
  if (sheets.length > 20) throw new Error('工作表数量超过上限');
  return sheets.map(({ name, rows }) => {
    if (!name || name.length > 31 || /[\\/?*[\]:]/.test(name)) throw new Error('工作表名称不正确');
    if (rows.length > 50000) throw new Error('报表行数超过五万行预算，请缩小范围');
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    cells += (rows.length + 1) * columns.length;
    if (cells > 500000) throw new Error('报表单元格超过预算，请缩小范围');
    const cell = (value: unknown): Cell => {
      if (value == null) return null;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('报表数值不正确');
        return { type: Number, value };
      }
      if (typeof value === 'boolean') return { type: Boolean, value };
      if (typeof value !== 'string' || value.length > 32767) throw new Error('报表文本超出单元格上限');
      return { type: String, format: '@', value };
    };
    return { sheet: name, data: [columns.map(value => ({ type: String, value, fontWeight: 'bold' as const })),
      ...rows.map(row => columns.map(key => cell(row[key])))] };
  });
}
