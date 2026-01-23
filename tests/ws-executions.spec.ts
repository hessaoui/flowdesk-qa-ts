import { describe, it, expect } from "vitest";
import { startWsServer } from "../src/wsServer.js";
import { TradingEngine } from "../src/engine.js";
import { connectAndConsume } from "../src/wsClientConsumer.js";
import type { Order, Account } from "../src/types.js";

/**
 * Utility function to wait for async WebSocket message processing.
 * In production, you'd use proper message acknowledgment instead of sleep.
 */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * WebSocket execution tests demonstrating:
 * 1. Idempotency (duplicate event handling)
 * 2. Overfill prevention
 * 3. State machine correctness (OPEN -> PARTIALLY_FILLED -> FILLED)
 * 4. Post-fill rejection
 * 5. Order mismatch handling
 * 
 * These tests validate the system's resilience against:
 * - Network retries (duplicate events)
 * - Malicious/buggy clients (overfill attempts)
 * - Race conditions (concurrent executions)
 * - State corruption (invalid transitions)
 */
describe("WebSocket executions - idempotency & invariants", () => {
  
  it("ignores duplicate execution events (same eventId)", async () => {
    const server = startWsServer(0);
    const url = `ws://127.0.0.1:${server.getPort()}`;

    const order: Order = { id: "O1", quantity: 10, filledQuantity: 0, status: "OPEN" };
    const account: Account = { balance: 100 };
    const engine = new TradingEngine(order, account);

    const client = connectAndConsume(url, engine);
    await client.waitOpen();

    // Send original execution
    server.broadcast({ type: "execution", eventId: "E1", orderId: "O1", executedQuantity: 4 });
    
    // Send duplicate (simulates network retry or at-least-once delivery)
    server.broadcast({ type: "execution", eventId: "E1", orderId: "O1", executedQuantity: 4 });
    
    // Send another duplicate
    server.broadcast({ type: "execution", eventId: "E1", orderId: "O1", executedQuantity: 4 });

    await sleep(50);

    // Only processed once despite 3 messages
    expect(order.filledQuantity).toBe(4);
    expect(order.status).toBe("PARTIALLY_FILLED");
    expect(account.balance).toBe(96);
    expect(engine.getProcessedEventIds().size).toBe(1);

    await client.close();
    await server.close();
  });

  it("caps overfill and reaches FILLED without exceeding quantity", async () => {
    const server = startWsServer(0);
    const url = `ws://127.0.0.1:${server.getPort()}`;

    const order: Order = { id: "O2", quantity: 10, filledQuantity: 9, status: "PARTIALLY_FILLED" };
    const account: Account = { balance: 100 };
    const engine = new TradingEngine(order, account);

    const client = connectAndConsume(url, engine);
    await client.waitOpen();

    // Try to execute 5 units when only 1 remains
    server.broadcast({ type: "execution", eventId: "E2", orderId: "O2", executedQuantity: 5 });

    await sleep(50);

    // Critical invariant: never exceed order quantity
    expect(order.filledQuantity).toBe(10);
    expect(order.filledQuantity).toBeLessThanOrEqual(order.quantity);
    expect(order.status).toBe("FILLED");

    // Only remaining quantity (1) is applied to balance
    expect(account.balance).toBe(99);

    await client.close();
    await server.close();
  });

  it("rejects executions after order is FILLED", async () => {
    const server = startWsServer(0);
    const url = `ws://127.0.0.1:${server.getPort()}`;

    const order: Order = { id: "O3", quantity: 10, filledQuantity: 10, status: "FILLED" };
    const account: Account = { balance: 100 };
    const engine = new TradingEngine(order, account);

    const client = connectAndConsume(url, engine);
    await client.waitOpen();

    // Attempt execution on already-filled order
    server.broadcast({ type: "execution", eventId: "E3", orderId: "O3", executedQuantity: 1 });

    await sleep(50);

    // State should remain unchanged
    expect(order.filledQuantity).toBe(10);
    expect(order.status).toBe("FILLED");
    expect(account.balance).toBe(100);

    await client.close();
    await server.close();
  });

  it("handles multiple distinct executions correctly", async () => {
    const server = startWsServer(0);
    const url = `ws://127.0.0.1:${server.getPort()}`;

    const order: Order = { id: "O4", quantity: 10, filledQuantity: 0, status: "OPEN" };
    const account: Account = { balance: 100 };
    const engine = new TradingEngine(order, account);

    const client = connectAndConsume(url, engine);
    await client.waitOpen();

    // Sequential executions with different eventIds
    server.broadcast({ type: "execution", eventId: "E4a", orderId: "O4", executedQuantity: 3 });
    await sleep(20);
    server.broadcast({ type: "execution", eventId: "E4b", orderId: "O4", executedQuantity: 4 });
    await sleep(20);
    server.broadcast({ type: "execution", eventId: "E4c", orderId: "O4", executedQuantity: 2 });
    await sleep(20);

    // Total: 3 + 4 + 2 = 9
    expect(order.filledQuantity).toBe(9);
    expect(order.status).toBe("PARTIALLY_FILLED");
    expect(account.balance).toBe(91);
    expect(engine.getProcessedEventIds().size).toBe(3);

    await client.close();
    await server.close();
  });

  it("rejects executions for wrong orderId", async () => {
    const server = startWsServer(0);
    const url = `ws://127.0.0.1:${server.getPort()}`;

    const order: Order = { id: "O5", quantity: 10, filledQuantity: 0, status: "OPEN" };
    const account: Account = { balance: 100 };
    const engine = new TradingEngine(order, account);

    const client = connectAndConsume(url, engine);
    await client.waitOpen();

    // Send execution for different order
    server.broadcast({ type: "execution", eventId: "E5", orderId: "WRONG_ORDER", executedQuantity: 5 });

    await sleep(50);

    // State should remain unchanged
    expect(order.filledQuantity).toBe(0);
    expect(order.status).toBe("OPEN");
    expect(account.balance).toBe(100);
    expect(engine.getProcessedEventIds().size).toBe(0);

    await client.close();
    await server.close();
  });

  it("rejects executions with invalid (non-positive) quantity", async () => {
    const server = startWsServer(0);
    const url = `ws://127.0.0.1:${server.getPort()}`;

    const order: Order = { id: "O6", quantity: 10, filledQuantity: 0, status: "OPEN" };
    const account: Account = { balance: 100 };
    const engine = new TradingEngine(order, account);

    const client = connectAndConsume(url, engine);
    await client.waitOpen();

    // Try zero quantity
    server.broadcast({ type: "execution", eventId: "E6a", orderId: "O6", executedQuantity: 0 });
    await sleep(20);

    // Try negative quantity
    server.broadcast({ type: "execution", eventId: "E6b", orderId: "O6", executedQuantity: -5 });
    await sleep(20);

    // State should remain unchanged
    expect(order.filledQuantity).toBe(0);
    expect(order.status).toBe("OPEN");
    expect(account.balance).toBe(100);
    expect(engine.getProcessedEventIds().size).toBe(0);

    await client.close();
    await server.close();
  });

  it("transitions through OPEN -> PARTIALLY_FILLED -> FILLED correctly", async () => {
    const server = startWsServer(0);
    const url = `ws://127.0.0.1:${server.getPort()}`;

    const order: Order = { id: "O7", quantity: 10, filledQuantity: 0, status: "OPEN" };
    const account: Account = { balance: 100 };
    const engine = new TradingEngine(order, account);

    const client = connectAndConsume(url, engine);
    await client.waitOpen();

    // Initial state: OPEN
    expect(order.status).toBe("OPEN");

    // Partial fill -> PARTIALLY_FILLED
    server.broadcast({ type: "execution", eventId: "E7a", orderId: "O7", executedQuantity: 4 });
    await sleep(30);
    expect(order.status).toBe("PARTIALLY_FILLED");
    expect(order.filledQuantity).toBe(4);

    // Another partial fill -> still PARTIALLY_FILLED
    server.broadcast({ type: "execution", eventId: "E7b", orderId: "O7", executedQuantity: 3 });
    await sleep(30);
    expect(order.status).toBe("PARTIALLY_FILLED");
    expect(order.filledQuantity).toBe(7);

    // Complete fill -> FILLED
    server.broadcast({ type: "execution", eventId: "E7c", orderId: "O7", executedQuantity: 3 });
    await sleep(30);
    expect(order.status).toBe("FILLED");
    expect(order.filledQuantity).toBe(10);
    expect(account.balance).toBe(90);

    await client.close();
    await server.close();
  });
});
