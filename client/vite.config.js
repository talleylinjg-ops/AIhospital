import { defineConfig } from "vite";

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
  ],
});
