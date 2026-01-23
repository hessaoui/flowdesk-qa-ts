import { describe, it, expect } from "vitest";
import { TradingEngine } from "../src/engine.js";
import { startWsServer } from "../src/wsServer.js";
import { connectAndConsume } from "../src/wsClientConsumer.js";
import type { Order, Account, ExecutionEvent } from "../src/types.js";

/**
 * Coverage improvement tests for edge cases and error paths.
 * These tests focus on lines that were uncovered in the initial test run.
 */
describe("Coverage improvements - edge cases", () => {
  
  describe("TradingEngine - unsupported event types (engine.ts:46)", () => {
    it("rejects non-execution event types", () => {
      const order: Order = { id: "O1", quantity: 10, filledQuantity: 0, status: "OPEN" };
      const account: Account = { balance: 100 };
      const engine = new TradingEngine(order, account);

      // Send an event with type !== "execution"
      const result = engine.applyExecution({
        type: "cancellation", // unsupported type
        eventId: "E1",
        orderId: "O1",
        executedQuantity: 5,
      } as unknown as ExecutionEvent);

      expect(result.applied).toBe(false);
      expect(result.reason).toBe("unsupported_event");
      expect(order.filledQuantity).toBe(0); // unchanged
      expect(order.status).toBe("OPEN");
    });
  });

  describe("TradingEngine - exact quantity remaining (engine.ts:83)", () => {
    it("transitions from PARTIALLY_FILLED to FILLED with exact remaining quantity", () => {
      const order: Order = { id: "O2", quantity: 10, filledQuantity: 7, status: "PARTIALLY_FILLED" };
      const account: Account = { balance: 100 };
      const engine = new TradingEngine(order, account);

      // Execute exactly the remaining quantity (3 units)
      const result = engine.applyExecution({
        type: "execution",
        eventId: "E2",
        orderId: "O2",
        executedQuantity: 3,
      });

      expect(result.applied).toBe(true);
      expect(result.reason).toBeUndefined(); // No overfill capping
      expect(order.filledQuantity).toBe(10);
      expect(order.status).toBe("FILLED");
      expect(account.balance).toBe(97);
    });
  });

  describe("TradingEngine - OPEN status with partial fill (engine.ts:109)", () => {
    it("correctly leaves status as OPEN when filledQuantity is 0", () => {
      const order: Order = { id: "O3", quantity: 10, filledQuantity: 0, status: "OPEN" };
      const account: Account = { balance: 100 };
      const engine = new TradingEngine(order, account);

      // Execute 0 units (edge case that gets rejected before status update)
      const result = engine.applyExecution({
        type: "execution",
        eventId: "E3",
        orderId: "O3",
        executedQuantity: 0,
      });

      expect(result.applied).toBe(false);
      expect(result.reason).toBe("invalid_executed_quantity");
      expect(order.filledQuantity).toBe(0);
      expect(order.status).toBe("OPEN");
    });

    it("maintains order status when filled quantity remains at 0 after rejection", () => {
      const order: Order = { id: "O4", quantity: 10, filledQuantity: 0, status: "OPEN" };
      const account: Account = { balance: 100 };
      const engine = new TradingEngine(order, account);

      // Reject due to wrong orderId
      const result = engine.applyExecution({
        type: "execution",
        eventId: "E4",
        orderId: "WRONG_ID",
        executedQuantity: 5,
      });

      expect(result.applied).toBe(false);
      expect(order.status).toBe("OPEN");
      expect(order.filledQuantity).toBe(0);
    });
  });

  describe("WebSocket server - error on getPort when not listening (wsServer.ts:38)", () => {
    it("throws error when getPort is called on non-listening server", async () => {
      const server = startWsServer(0);
      await server.close();

      // After closing, address() returns null
      expect(() => server.getPort()).toThrow("Cannot get server port");
    });
  });

  describe("WebSocket client - connection error handling (wsClientConsumer.ts:31)", () => {
    it("handles malformed event gracefully when processing fails", async () => {
      const server = startWsServer(0);
      const url = `ws://127.0.0.1:${server.getPort()}`;

      const order: Order = { id: "O5", quantity: 10, filledQuantity: 0, status: "OPEN" };
      const account: Account = { balance: 100 };
      const engine = new TradingEngine(order, account);

      const client = connectAndConsume(url, engine);
      await client.waitOpen();

      // Send a message with missing required fields (will be caught and ignored)
      server.wss.clients.forEach((ws) => {
        ws.send(JSON.stringify({ type: "execution" })); // Missing orderId, eventId, executedQuantity
      });

      await new Promise((r) => setTimeout(r, 50));

      // Order should be unchanged since malformed event is rejected
      expect(order.filledQuantity).toBe(0);
      expect(order.status).toBe("OPEN");

      await client.close();
      await server.close();
    });
  });

  describe("WebSocket client - JSON parse errors (wsClientConsumer.ts implicit)", () => {
    it("silently ignores malformed JSON messages", async () => {
      const server = startWsServer(0);
      const url = `ws://127.0.0.1:${server.getPort()}`;

      const order: Order = { id: "O6", quantity: 10, filledQuantity: 0, status: "OPEN" };
      const account: Account = { balance: 100 };
      const engine = new TradingEngine(order, account);

      const client = connectAndConsume(url, engine);
      await client.waitOpen();

      // Send invalid JSON (this tests the catch block)
      server.wss.clients.forEach((ws) => {
        ws.send("{invalid json");
        ws.send("not even json");
      });

      await new Promise((r) => setTimeout(r, 50));

      // Order should be unchanged since malformed messages are caught
      expect(order.filledQuantity).toBe(0);
      expect(order.status).toBe("OPEN");

      await client.close();
      await server.close();
    });

    it("processes valid messages interspersed with malformed ones", async () => {
      const server = startWsServer(0);
      const url = `ws://127.0.0.1:${server.getPort()}`;

      const order: Order = { id: "O7", quantity: 10, filledQuantity: 0, status: "OPEN" };
      const account: Account = { balance: 100 };
      const engine = new TradingEngine(order, account);

      const client = connectAndConsume(url, engine);
      await client.waitOpen();

      // Send: invalid, valid, invalid, valid
      server.wss.clients.forEach((ws) => {
        ws.send("{bad");
        ws.send(JSON.stringify({ type: "execution", eventId: "E7a", orderId: "O7", executedQuantity: 3 }));
        ws.send("not json");
        ws.send(JSON.stringify({ type: "execution", eventId: "E7b", orderId: "O7", executedQuantity: 2 }));
      });

      await new Promise((r) => setTimeout(r, 50));

      // Only valid messages should be processed (3 + 2 = 5)
      expect(order.filledQuantity).toBe(5);
      expect(account.balance).toBe(95);

      await client.close();
      await server.close();
    });
  });

  describe("Server health endpoint - POST/other methods (server.ts:11-12 implicit)", () => {
    it("returns 404 for POST requests", async () => {
      const { createServer } = await import("../src/server.js");
      const server = createServer();

      const port = await new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          if (typeof addr === "object" && addr) resolve(addr.port);
        });
      });

      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ test: true }),
        });

        expect(response.status).toBe(404);
      } finally {
        server.close();
      }
    });

    it("returns 404 for requests to non-existent routes", async () => {
      const { createServer } = await import("../src/server.js");
      const server = createServer();

      const port = await new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          if (typeof addr === "object" && addr) resolve(addr.port);
        });
      });

      try {
        const response = await fetch(`http://127.0.0.1:${port}/unknown-route`);
        expect(response.status).toBe(404);
      } finally {
        server.close();
      }
    });

    it("returns 404 for PUT/DELETE/PATCH to health endpoint", async () => {
      const { createServer } = await import("../src/server.js");
      const server = createServer();

      const port = await new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          if (typeof addr === "object" && addr) resolve(addr.port);
        });
      });

      try {
        for (const method of ["PUT", "DELETE", "PATCH"]) {
          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            method,
          });
          expect(response.status).toBe(404);
        }
      } finally {
        server.close();
      }
    });
  });

  describe("TradingEngine - capped overfill reason feedback (engine.ts implicit)", () => {
    it("returns reason 'capped_overfill' when execution is capped", () => {
      const order: Order = { id: "O8", quantity: 10, filledQuantity: 8, status: "PARTIALLY_FILLED" };
      const account: Account = { balance: 100 };
      const engine = new TradingEngine(order, account);

      // Try to execute 10 units when only 2 remain
      const result = engine.applyExecution({
        type: "execution",
        eventId: "E8",
        orderId: "O8",
        executedQuantity: 10,
      });

      expect(result.applied).toBe(true);
      expect(result.reason).toBe("capped_overfill");
      expect(order.filledQuantity).toBe(10);
      expect(order.status).toBe("FILLED");
    });
  });

  describe("TradingEngine - getProcessedEventIds returns copy (engine.ts implicit)", () => {
    it("returns a copy of processedEventIds, not reference", () => {
      const order: Order = { id: "O9", quantity: 10, filledQuantity: 0, status: "OPEN" };
      const account: Account = { balance: 100 };
      const engine = new TradingEngine(order, account);

      engine.applyExecution({
        type: "execution",
        eventId: "E9a",
        orderId: "O9",
        executedQuantity: 3,
      });

      const ids1 = engine.getProcessedEventIds();
      expect(ids1.size).toBe(1);
      expect(ids1.has("E9a")).toBe(true);

      // Modify the returned set
      ids1.add("E9b");

      // Original should still have only 1
      const ids2 = engine.getProcessedEventIds();
      expect(ids2.size).toBe(1);
      expect(ids2.has("E9b")).toBe(false);
    });
  });

  describe("TradingEngine - clearProcessedEvents", () => {
    it("clears all processed event IDs", () => {
      const order: Order = { id: "O10", quantity: 10, filledQuantity: 0, status: "OPEN" };
      const account: Account = { balance: 100 };
      const engine = new TradingEngine(order, account);

      engine.applyExecution({
        type: "execution",
        eventId: "E10a",
        orderId: "O10",
        executedQuantity: 3,
      });
      engine.applyExecution({
        type: "execution",
        eventId: "E10b",
        orderId: "O10",
        executedQuantity: 2,
      });

      expect(engine.getProcessedEventIds().size).toBe(2);

      engine.clearProcessedEvents();

      expect(engine.getProcessedEventIds().size).toBe(0);

      // After clearing, duplicate detection is reset
      const result = engine.applyExecution({
        type: "execution",
        eventId: "E10a", // Same ID as before
        orderId: "O10",
        executedQuantity: 1,
      });

      expect(result.applied).toBe(true); // Now accepted because cache was cleared
      expect(order.filledQuantity).toBe(6); // 3 + 2 + 1 = 6
    });
  });
});
