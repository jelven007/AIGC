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
  };
});
