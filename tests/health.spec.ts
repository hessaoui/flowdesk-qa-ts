import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../src/server.js";

let server: ReturnType<typeof createServer>;
let baseUrl = "";

describe("API smoke - /health", () => {
  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns ok=true", async () => {
    const r = await fetch(`${baseUrl}/health`);
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json).toEqual({ ok: true });
  });
});
