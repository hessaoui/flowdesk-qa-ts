import { describe, it, expect } from "vitest";
import { executeOrder, type Order, type Account } from "../src/executeOrder.js";

describe("executeOrder - QA risk tests", () => {
  it("enforces status consistency for a partial fill", () => {
    const order: Order = { id: "O1", side: "BUY", quantity: 10, filledQuantity: 0, status: "OPEN" };
    const account: Account = { balance: 100 };

    executeOrder(order, account, 3);

    expect(order.filledQuantity).toBe(3);
    expect(order.status).toBe("PARTIALLY_FILLED");
    expect(account.balance).toBe(97);
  });

  it("should never allow overfill (invariant: filledQuantity <= quantity)", () => {
    const order: Order = { id: "O2", side: "BUY", quantity: 10, filledQuantity: 9, status: "PARTIALLY_FILLED" };
    const account: Account = { balance: 100 };

    executeOrder(order, account, 5);

    // Invariant assertion (expected behavior). This will FAIL with current implementation.
    expect(order.filledQuantity).toBeLessThanOrEqual(order.quantity);
  });

  it("should be idempotent against duplicate executions (must be handled by design)", () => {
    const order: Order = { id: "O3", side: "BUY", quantity: 10, filledQuantity: 0, status: "OPEN" };
    const account: Account = { balance: 100 };

    executeOrder(order, account, 4);

    const afterFirst = {
      filled: order.filledQuantity,
      status: order.status,
      balance: account.balance
    };

    // duplicate event (same execution delivered twice)
    executeOrder(order, account, 4);

    // Domain expectation; will FAIL today (that is the point of the guardrail).
    expect(order.filledQuantity).toBe(afterFirst.filled);
    expect(order.status).toBe(afterFirst.status);
    expect(account.balance).toBe(afterFirst.balance);
  });

  it("handles SELL orders correctly (increases balance)", () => {
    const order: Order = { id: "O4", side: "SELL", quantity: 10, filledQuantity: 0, status: "OPEN" };
    const account: Account = { balance: 100 };

    executeOrder(order, account, 3);

    expect(order.filledQuantity).toBe(3);
    expect(order.status).toBe("PARTIALLY_FILLED");
    expect(account.balance).toBe(103); // Balance increases for sell orders
  });

  it("prevents overfill for SELL orders", () => {
    const order: Order = { id: "O5", side: "SELL", quantity: 10, filledQuantity: 8, status: "PARTIALLY_FILLED" };
    const account: Account = { balance: 100 };

    executeOrder(order, account, 5);

    expect(order.filledQuantity).toBe(10);
    expect(order.status).toBe("FILLED");
    expect(account.balance).toBe(102); // Only 2 units filled (not 5)
  });

  it("maintains idempotency for SELL orders", () => {
    const order: Order = { id: "O6", side: "SELL", quantity: 10, filledQuantity: 0, status: "OPEN" };
    const account: Account = { balance: 100 };

    executeOrder(order, account, 5);

    const afterFirst = {
      filled: order.filledQuantity,
      status: order.status,
      balance: account.balance
    };

    // duplicate event
    executeOrder(order, account, 5);

    expect(order.filledQuantity).toBe(afterFirst.filled);
    expect(order.status).toBe(afterFirst.status);
    expect(account.balance).toBe(afterFirst.balance);
  });
});
