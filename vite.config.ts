import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import svgr from "vite-plugin-svgr";
import path from "path";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    throw new Error('请配置自己的火山 BaaS URL 和 anon key；参见 .env.example');
  }
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('VITE_') && value && name !== 'VITE_SUPABASE_ANON_KEY'
      && /KEY|SECRET|TOKEN|PASSWORD/i.test(name)) {
      throw new Error(`禁止将服务端密钥 ${name} 打包到浏览器，请配置 Edge Function Secrets`);
    }
  }
  return {
  // 多个本地后端/测试服务共享依赖时，预构建缓存不能互相覆盖。
  cacheDir: path.resolve(__dirname, '.vite_cache', mode, new URL(env.VITE_SUPABASE_URL).hostname),
  server: { watch: { ignored: ['**/.volcengine-build/**'] } },
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return;
          if (/\/(?:react|react-dom|scheduler)\/|\/@remix-run\/router\/|\/react-router(?:-dom)?\//.test(id)) return 'react-core';
          if (id.includes('/@supabase/')) return 'supabase';
          if (id.includes('/@tanstack/')) return 'query';
          if (id.includes('/framer-motion/') || id.includes('/motion-')) return 'motion';
          // 保持页面专用编辑/图表/导出依赖按其动态入口加载。
        },
      },
    },
  },
  };
});
