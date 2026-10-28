import { executeTestClient, loadTestClient } from "dismock/runtime";
const project = await loadTestClient(
  new URL("../packages/bot/src/testClient.ts", import.meta.url),
);
await executeTestClient(project, []);
