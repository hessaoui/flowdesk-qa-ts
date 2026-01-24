import { test, expect } from "@playwright/test";
import WebSocket from "ws";
import { ExecutionConsumer } from "./helpers/executionConsumer";

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

test("[TC_API_IDEMPOTENCY_001] API: client-side idempotency with eventId (dedup cache)", async ({ request }) => {
  // Create order
  const createResp = await request.post(`${ENGINE_URL}/orders`, {
    data: { quantity: 100 }
  });
  await expect(createResp).toBeOK();
  const order = await createResp.json();
  const orderId = order.orderId;

  // Initialize client-side consumer to track state
  const consumer = new ExecutionConsumer(
    { id: orderId, quantity: 100, filledQuantity: 0, status: "OPEN" },
    { balance: 1000 }
  );

  // Send first execution with eventId
  const eventId1 = `E-test-${Date.now()}-1`;
  const exec1Resp = await request.post(`${ENGINE_URL}/execute`, {
    data: { orderId, quantity: 50, eventId: eventId1 }
  });
  await expect(exec1Resp).toBeOK();
  const exec1 = await exec1Resp.json();
  expect(exec1.applied).toBe(true);
  expect(exec1.eventId).toBe(eventId1);

  // Apply to consumer and verify state
  const result1 = consumer.apply({
    type: "execution",
    eventId: eventId1,
    orderId,
    executedQuantity: 50
  });
  expect(result1.applied).toBe(true);
  expect(consumer.order.filledQuantity).toBe(50);
  expect(consumer.order.status).toBe("PARTIALLY_FILLED");

  // Send DUPLICATE with same eventId (network retry scenario)
  const exec2Resp = await request.post(`${ENGINE_URL}/execute`, {
    data: { orderId, quantity: 50, eventId: eventId1 }
  });
  await expect(exec2Resp).toBeOK();
  const exec2 = await exec2Resp.json();
  expect(exec2.applied).toBe(false); // ← Server rejected duplicate
  expect(exec2.reason).toBe("duplicate");

  // Apply to consumer - should be rejected (idempotent)
  const result2 = consumer.apply({
    type: "execution",
    eventId: eventId1,
    orderId,
    executedQuantity: 50
  });
  expect(result2.applied).toBe(false);
  expect(result2.reason).toBe("duplicate");
  
  // State must NOT change on duplicate
  expect(consumer.order.filledQuantity).toBe(50); // Still 50, not 100
  expect(consumer.order.status).toBe("PARTIALLY_FILLED");

  // Send third execution with NEW eventId to complete order
  const eventId2 = `E-test-${Date.now()}-2`;
  const exec3Resp = await request.post(`${ENGINE_URL}/execute`, {
    data: { orderId, quantity: 50, eventId: eventId2 }
  });
  await expect(exec3Resp).toBeOK();
  const exec3 = await exec3Resp.json();
  expect(exec3.applied).toBe(true);

  // Apply to consumer
  const result3 = consumer.apply({
    type: "execution",
    eventId: eventId2,
    orderId,
    executedQuantity: 50
  });
  expect(result3.applied).toBe(true);
  expect(consumer.order.filledQuantity).toBe(100);
  expect(consumer.order.status).toBe("FILLED");

  // Verify consumer invariants
  consumer.assertInvariants();
  
  const metrics = consumer.getMetrics();
  console.log(`✓ Idempotency verified: ${metrics.appliedCount} applied, ${metrics.duplicateCount} duplicates rejected`);
});

test.skip("[TC_UI_001] UI: client platform displays and can query engine health", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("title")).toHaveText(/Client Platform/);

  await page.click("#btn");
  await page.waitForTimeout(500); // Wait for async fetch
  const txt = await page.getByTestId("health").textContent();
  expect(txt || "").toContain("ok");
});
