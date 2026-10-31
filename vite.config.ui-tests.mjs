/** 仅隔离浏览器门禁启用；生产开发入口不暴露测试夹具。 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import configure from './vite.config.mjs';

const repository = path.dirname(fileURLToPath(import.meta.url));
export default context => {
  const config = configure(context);
  return {
    ...config,
    server: { ...config.server, fs: { allow: [repository] } },
    plugins: [...config.plugins, {
      name: 'isolated-browser-fixtures',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const url = request.url || '';
          if (!/^\/tests\/ui\/(?:model-settings|platform-settings)\.(?:html|tsx)(?:\?|$)/.test(url)) {
            next();
            return;
          }
          try {
            if (url.split('?')[0].endsWith('.html')) {
              const html = await readFile(repository + url.split('?')[0], 'utf8');
              response.setHeader('Content-Type', 'text/html; charset=utf-8');
              response.end(await server.transformIndexHtml(url, html));
              return;
            }
            request.url = '/@fs' + repository + url;
            next();
          } catch (error) {
            next(error);
          }
        });
      },
    }],
  };
};
