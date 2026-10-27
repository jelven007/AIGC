import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadEdge } from './edge-loader.mjs';

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-01-01T00:00:00.123456+00:00';
const id = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let rows = Array.from({ length: 205 }, (_, n) => ({ id: id(n + 1), user_id: user, created_at: stamp }));
rows.push({ id: id(999), user_id: other, created_at: stamp });
globalThis.Deno = { env: { get: key => ({
  SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
})[key] }, serve() {} };
globalThis.__createClient = () => ({
  auth: { getUser: async () => ({ data: { user: { id: user } } }) },
  rpc: async () => ({ data: true }),
  from(table) {
    assert.equal(table, 'products');
    let owner, cursor, start = 0, end = 99;
    return {
      select() { return this; },
      eq(column, value) { if (column === 'user_id') owner = value; return this; },
      order() { return this; },
      range(a, b) { start = a; end = b; return this; },
      limit(n) { end = n - 1; return this; },
      or(expression) {
        const match = /^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.gt\.([^)]+)\)$/.exec(expression);
        assert.ok(match, '游标必须只含经过验证的时间戳和UUID');
        assert.equal(match[1], match[2]); cursor = { created_at: match[1], id: match[3] }; return this;
      },
      then(resolve) {
        let filtered = rows.filter(row => row.user_id === owner)
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
        if (cursor) filtered = filtered.filter(row => row.created_at < cursor.created_at
          || row.created_at === cursor.created_at && row.id > cursor.id);
        resolve({ data: filtered.slice(start, end + 1), count: filtered.length });
      },
    };
  },
});
const { handleProductManagement } = await loadEdge('supabase/functions/product-management/index.ts', 'product-pagination');
const request = body => handleProductManagement(new Request('https://db.example/functions/v1/product-management', {
  method: 'POST', headers: { Authorization: 'Bearer user' }, body: JSON.stringify({ action: 'list', ...body }),
}));

test('同时间戳游标保留微秒，新增商品后续页不重复、不过滤其他账号', async () => {
  const first = await (await request({ pagination: 'cursor', limit: 100 })).json();
  assert.equal(first.total, 205);
  assert.deepEqual(first.next_cursor, { created_at: stamp, id: id(100) });
  rows.unshift({ id: id(0), user_id: user, created_at: '2026-01-02T00:00:00.000000+00:00' });
  const second = await (await request({ pagination: 'cursor', limit: 100, cursor: first.next_cursor })).json();
  assert.deepEqual(second.products.map(row => row.id), Array.from({ length: 100 }, (_, n) => id(n + 101)));
  assert.equal(second.total, null);
  const final = await (await request({ pagination: 'cursor', limit: 100, cursor: second.next_cursor })).json();
  assert.equal(final.products.length, 5); assert.equal(final.next_cursor, null);
});

test('游标非法、混用offset/价格排序拒绝；旧offset路径仍可用', async () => {
  const cursor = { created_at: stamp, id: id(100) };
  for (const options of [{ cursor: { ...cursor, id: 'bad' } },
    { cursor: { ...cursor, created_at: `${stamp}),id.neq.x` } }, { cursor: {} }, { cursor: [] },
    { cursor, offset: 100 }, { cursor, sort: 'price_desc' }, { cursor, pagination: 'unknown' }]) {
    assert.equal((await request({ pagination: 'cursor', ...options })).status, 400);
  }
  const response = await request({ offset: 100, limit: 100 });
  assert.equal(response.status, 200); assert.equal((await response.json()).offset, 100);
});
