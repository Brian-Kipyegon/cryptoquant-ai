// Must be the first import: loads .env before other modules read process.env.
import "./server/env";
import { PORT } from "./server/config";
import { createApp } from "./server/app";

// Global Error Handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

async function startServer() {
  const app = await createApp();
  app.listen(PORT, () => {
    console.log(`[Server] Listening on http://127.0.0.1:${PORT} (${process.env.NODE_ENV || "development"})`);
  });
}

startServer().catch((error) => {
  console.error("[Server] Failed to start:", error);
  process.exit(1);
});
