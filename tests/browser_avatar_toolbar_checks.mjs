import assert from 'node:assert/strict';

/** Measure the visible controls, then exercise both library states and dialogs. */
export async function verifyAvatarToolbar(page, width, touch = false) {
  const search = page.getByPlaceholder('搜索数字人名称或标签...');
  await search.waitFor();
  const result = await page.locator('main').evaluate(main => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const controls = main.querySelector('[data-library-actions]');
    const filter = main.querySelector('[data-library-filter-heading]');
    return { selected: rect(main.querySelector('[data-page-actions] [aria-pressed="true"]')),
      search: rect(main.querySelector('input[placeholder="搜索数字人名称或标签..."]')),
      buttons: [...controls.querySelectorAll('button')].filter(node => node.getBoundingClientRect().width > 0)
        .map(node => ({ ...rect(node), name: node.getAttribute('aria-label') || node.textContent.trim() })),
      filter: filter && filter.getBoundingClientRect().width > 0 ? rect(filter) : null,
      contentRight: rect(main.querySelector('[data-page-header]')).right,
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  const height = touch ? 44 : 32;
  assert.equal(result.selected.height, height, 'library selector target height');
  for (const control of [result.search, ...result.buttons, ...(width >= 1024 ? [result.filter] : [])]) {
    assert.ok(control, 'desktop filter heading should join the toolbar');
    assert.equal(control.height, result.selected.height, 'toolbar height matches library selector');
    assert.ok(Math.abs(control.y - result.search.y) < 1, 'filter, search and upload align vertically');
    assert.ok(control.right <= result.contentRight + 1, 'toolbar control stays within content');
  }
  const upload = result.buttons.find(button => button.name === '上传头像');
  assert.ok(Math.abs(upload.right - result.contentRight) < 1, 'upload stays at the content right edge');
  assert.ok(result.search.width >= 100, 'narrow screens retain a usable search field');
  assert.equal(result.overflow, false);
  await search.fill('对齐验收');
  assert.equal(await search.inputValue(), '对齐验收');
  if (width < 1024) {
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '筛选数字人', exact: true });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '应用筛选', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: '上传头像', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  const actions = page.locator('[data-page-actions]');
  await actions.getByRole('button', { name: '视频模板库', exact: true }).press('Enter');
  assert.equal(await page.getByRole('button', { name: '上传头像', exact: true }).count(), 0);
  await actions.getByRole('button', { name: '数字人库', exact: true }).click();
  await page.getByRole('button', { name: '上传头像', exact: true }).waitFor();
  return result;
}
