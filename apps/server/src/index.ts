import { createHttpServer } from "./http/server.js";
import { createAppState } from "./state.js";

const port = Number(process.env["PORT"] ?? 8787);
const state = createAppState();
const server = createHttpServer(state);

server.listen(port, () => {
  console.log(`ActionHarbor demo server listening on http://localhost:${port}`);
});
