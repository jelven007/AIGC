import { parseArgs } from 'node:util';
import { build } from 'vite';
import { resolve } from 'node:path';
import configure from '../vite.config.mjs';

const { values } = parseArgs({ options: {
  mode: { type: 'string', default: 'production' },
  minify: { type: 'string' },
  logLevel: { type: 'string' },
  outDir: { type: 'string' },
} });
const config = configure({ mode: values.mode, command: 'build', isSsrBuild: false, isPreview: false });
await build({ ...config, mode: values.mode, configFile: false,
  ...(values.logLevel ? { logLevel: values.logLevel } : {}),
  build: { ...config.build,
    ...(values.minify ? { minify: values.minify === 'false' ? false : values.minify } : {}),
    ...(values.outDir ? { outDir: resolve(values.outDir) } : {}),
  },
});
