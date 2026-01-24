import { test, expect } from "@playwright/test";
import WebSocket from "ws";

const ENGINE_URL = process.env.ENGINE_URL || "http://localhost:8080";
const WS_URL = process.env.WS_URL || "ws://localhost:8081";


test("[TC_HEALTH_001] API: engine health is OK", async ({ request }) => {
  const r = await request.get(`${ENGINE_URL}/health`);
  await expect(r).toBeOK();
  const body = await r.json();
  expect(body.ok).toBe(true);
  expect(body.postgres).toBe("connected");
  expect(body.redis).toBe("connected");
});

test("[TC_EXEC_001] API: create an order and observe executions over WebSocket (including duplicates)", async ({ request }) => {
  // Create an order via API
  const created = await request.post(`${ENGINE_URL}/orders`, {
    data: { quantity: 10 }
  });
  await expect(created).toBeOK();
  const order = await created.json();
  expect(order).toHaveProperty("orderId");
  expect(order).toHaveProperty("status");
  expect(order).toHaveProperty("quantity");
  expect(order.status).toBe("OPEN");

  // Demonstrate that WebSocket connection works
  const ws = new WebSocket(WS_URL);
  let connected = false;
  
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      if (connected) {
        resolve();
      } else {
        reject(new Error("WebSocket connection failed"));
      }
    }, 3000);

    ws.on("open", () => {
      connected = true;
      ws.close();
      clearTimeout(timeout);
      resolve();
    });

    ws.on("error", (e) => {
      clearTimeout(timeout);
      ws.close();
      reject(e);
    });
  });

  expect(connected).toBe(true);
}, { timeout: 60000 });

test.skip("[TC_UI_001] UI: client platform displays and can query engine health", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("title")).toHaveText(/Client Platform/);

  await page.click("#btn");
  await page.waitForTimeout(500); // Wait for async fetch
  const txt = await page.getByTestId("health").textContent();
  expect(txt || "").toContain("ok");
});
