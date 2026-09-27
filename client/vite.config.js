import { defineConfig } from "vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const clientRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    allowedHosts: [".monkeycode-ai.online"],
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    {
      name: "admin-page-redirect",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/admin" || req.url === "/admin/") {
            res.statusCode = 302;
            res.setHeader("Location", "/admin/index.html");
            res.end();
            return;
          }
          next();
        });
      },
    },
    {
      name: "publish-shared-config-for-admin",
      closeBundle() {
        const outDir = resolve(clientRoot, "dist/src");
        mkdirSync(outDir, { recursive: true });
        copyFileSync(resolve(clientRoot, "src/form-config.js"), resolve(outDir, "form-config.js"));
      },
    },
  ],
});
