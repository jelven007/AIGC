import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-loader.mjs';
const errors = await loadFrontend('src/api/modelSettings.ts', 'model-settings-errors', {
  'src/lib/edgeRequest.ts': `export class EdgeRequestError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  export async function authenticatedEdgeJSON() { throw new EdgeRequestError('NOT_FOUND', 404); }`,
});
assert.match(errors.modelSettingsErrorMessage(new TypeError('Failed to fetch')), /检查后端部署和网络/);
let missing;
try { await errors.modelSettingsRequest({ action: 'list' }); } catch (error) { missing = error; }
assert.match(errors.modelSettingsErrorMessage(missing), /model-settings.*数据库迁移/);
assert.equal(errors.modelSettingsErrorMessage(new Error('配置已被更新，请刷新后重试')), '配置已被更新，请刷新后重试');
console.log('PASS 网络失败/接口未部署提示可操作，保留服务端版本冲突说明');
