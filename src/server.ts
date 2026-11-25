import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { FirestoreStore } from "./store/firestore.js";
import { MemoryStore } from "./store/memory.js";
import type { StorageBackend } from "./store/types.js";

function createStore(backend: "firestore" | "memory", gcpProject?: string): StorageBackend {
  if (backend === "firestore") {
    return new FirestoreStore(gcpProject);
  }
  return new MemoryStore();
}

const config = loadConfig();
const store = createStore(config.storageBackend, config.gcpProject);
const app = createApp({ config, store });

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      msg: "shopcart-mcp listening",
      port: config.port,
      origin: config.appOrigin,
      storage: config.storageBackend,
      promoFreeProUntil: config.promoFreeProUntil?.toISOString() ?? null
    })
  );
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
