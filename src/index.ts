import { loadConfig } from "./config.js";
import { DshAcpHarness } from "./harness.js";
import { createMcpServer } from "./mcp-server.js";
import { TaskManager } from "./task-manager.js";
import { TaskStore } from "./task-store.js";

const config = loadConfig();
const store = new TaskStore(config.dataDir);
const harness = new DshAcpHarness(config);
const manager = new TaskManager(config, store, harness);

await manager.initialize();
const server = createMcpServer(manager);
await server.connect(new (await import("@modelcontextprotocol/sdk/server/stdio.js")).StdioServerTransport());

const shutdown = async () => {
  await manager.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
