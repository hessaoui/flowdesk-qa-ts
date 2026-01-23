import type { Account, Order, ExecutionEvent } from "./types.js";

/**
 * TradingEngine: manages order state and account balance with idempotency guarantees.
 * 
 * Key features for interview discussion:
 * 1. Idempotency via Set<eventId> - prevents duplicate processing
 * 2. Overfill prevention - caps execution at remaining quantity
 * 3. State validation - rejects executions on FILLED orders
 * 4. Atomic updates - all-or-nothing state changes
 * 
 * Production considerations to mention:
 * - In real systems, this would be backed by a database with transactions
 * - Event sourcing could provide better audit trail
 * - Separate read/write models (CQRS) for high throughput
 * - Time-based TTL for processedEventIds to prevent unbounded memory growth
 */
export class TradingEngine {
  private processedEventIds = new Set<string>();

  constructor(
    public order: Order,
    public account: Account
  ) {}

  /**
   * Idempotent execution handler.
   * 
   * Returns { applied: boolean, reason?: string } to provide feedback
   * on why an event was rejected (useful for monitoring/debugging).
   * 
   * Rejection reasons:
   * - duplicate_event: eventId already processed
   * - unknown_order: orderId doesn't match
   * - invalid_executed_quantity: non-positive quantity
   * - already_filled: order is already complete
   * - unsupported_event: event type not "execution"
   * 
   * Success reasons:
   * - capped_overfill: execution quantity exceeded remaining, was capped
   * - (no reason): normal successful execution
   */
  applyExecution(evt: ExecutionEvent): { applied: boolean; reason?: string } {
    // Guard: only handle execution events
    if (evt.type !== "execution") {
      return { applied: false, reason: "unsupported_event" };
    }

    // Idempotency check: reject duplicates
    if (this.processedEventIds.has(evt.eventId)) {
      return { applied: false, reason: "duplicate_event" };
    }

    // Validate order ID
    if (evt.orderId !== this.order.id) {
      return { applied: false, reason: "unknown_order" };
    }

    // Validate quantity
    if (evt.executedQuantity <= 0) {
      return { applied: false, reason: "invalid_executed_quantity" };
    }

    // Reject executions on already-filled orders
    if (this.order.status === "FILLED") {
      return { applied: false, reason: "already_filled" };
    }

    // Calculate effective quantity (prevent overfill)
    const remaining = this.order.quantity - this.order.filledQuantity;
    const effectiveQty = Math.min(evt.executedQuantity, remaining);

    // Apply state changes atomically
    this.order.filledQuantity += effectiveQty;
    this.account.balance -= effectiveQty;

    // Update order status based on fill level
    if (this.order.filledQuantity === this.order.quantity) {
      this.order.status = "FILLED";
    } else if (this.order.filledQuantity > 0) {
      this.order.status = "PARTIALLY_FILLED";
    } else {
      this.order.status = "OPEN";
    }

    // Mark event as processed (idempotency key)
    this.processedEventIds.add(evt.eventId);

    // Provide feedback if we capped the execution
    if (effectiveQty < evt.executedQuantity) {
      return { applied: true, reason: "capped_overfill" };
    }

    return { applied: true };
  }

  /**
   * Get the set of processed event IDs (useful for testing/debugging)
   */
  getProcessedEventIds(): Set<string> {
    return new Set(this.processedEventIds);
  }

  /**
   * Clear processed event IDs (useful for testing)
   * In production, you'd have TTL-based expiration instead
   */
  clearProcessedEvents(): void {
    this.processedEventIds.clear();
  }
}
