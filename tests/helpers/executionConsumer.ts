/**
 * Client-side execution consumer
 * Simulates how a UI or API gateway would handle execution events
 * 
 * Key behaviors:
 * - Idempotency via eventId tracking (dedup cache)
 * - Invariant enforcement (no overfill, no mutation when FILLED)
 * - Deterministic effective quantity (cap at remaining)
 * - State consistency validation
 */

export type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED";

export interface OrderState {
  id: string;
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
}

export interface AccountState {
  balance: number;
}

export interface ExecutionEvent {
  type: "execution";
  eventId: string;
  orderId: string;
  executedQuantity: number;
  timestamp?: number;
}

export interface ApplyResult {
  applied: boolean;
  reason?: string;
  effectiveQuantity?: number;
}

/**
 * Client-side consumer: what a UI / gateway would do
 */
export class ExecutionConsumer {
  private seen = new Set<string>();
  private appliedCount = 0;
  private rejectedCount = 0;
  private initialBalance: number;

  constructor(public order: OrderState, public account: AccountState) {
    this.initialBalance = account.balance;
  }

  /**
   * Apply execution event with full idempotency and invariant checks
   */
  apply(evt: ExecutionEvent): ApplyResult {
    // Invariant 1: Duplicate detection (idempotency)
    if (this.seen.has(evt.eventId)) {
      this.rejectedCount++;
      return { applied: false, reason: "duplicate" };
    }

    // Invariant 2: Order ID match
    if (evt.orderId !== this.order.id) {
      this.rejectedCount++;
      return { applied: false, reason: "wrong_order" };
    }

    // Invariant 3: Positive quantity
    if (evt.executedQuantity <= 0) {
      this.rejectedCount++;
      return { applied: false, reason: "invalid_qty" };
    }

    // Invariant 4: Cannot mutate if already FILLED
    if (this.order.status === "FILLED") {
      this.rejectedCount++;
      return { applied: false, reason: "already_filled" };
    }

    // Calculate effective quantity (cap at remaining)
    const remaining = this.order.quantity - this.order.filledQuantity;
    const effective = Math.min(evt.executedQuantity, remaining);

    // Apply state mutations
    this.order.filledQuantity += effective;
    this.account.balance -= effective;

    // Update order status based on fill level
    if (this.order.filledQuantity === this.order.quantity) {
      this.order.status = "FILLED";
    } else if (this.order.filledQuantity > 0) {
      this.order.status = "PARTIALLY_FILLED";
    } else {
      this.order.status = "OPEN";
    }

    // Mark as seen (idempotency cache)
    this.seen.add(evt.eventId);
    this.appliedCount++;

    const isCapped = effective < evt.executedQuantity;

    return {
      applied: true,
      reason: isCapped ? "capped" : undefined,
      effectiveQuantity: effective,
    };
  }

  /**
   * Get metrics for assertions
   */
  getMetrics() {
    return {
      appliedCount: this.appliedCount,
      rejectedCount: this.rejectedCount,
      seenCount: this.seen.size,
      duplicateCount: this.rejectedCount - (this.appliedCount + this.rejectedCount - this.seen.size),
    };
  }

  /**
   * Verify state consistency invariants
   */
  assertInvariants() {
    // Order quantity bounds
    if (this.order.filledQuantity < 0) {
      throw new Error(`Invariant violated: filledQuantity < 0 (${this.order.filledQuantity})`);
    }
    if (this.order.filledQuantity > this.order.quantity) {
      throw new Error(`Invariant violated: filledQuantity > quantity (${this.order.filledQuantity} > ${this.order.quantity})`);
    }

    // Status consistency
    if (this.order.filledQuantity === 0 && this.order.status !== "OPEN") {
      throw new Error(`Invariant violated: filled=0 but status=${this.order.status}`);
    }
    if (this.order.filledQuantity > 0 && this.order.filledQuantity < this.order.quantity && this.order.status !== "PARTIALLY_FILLED") {
      throw new Error(`Invariant violated: 0 < filled < quantity but status=${this.order.status}`);
    }
    if (this.order.filledQuantity === this.order.quantity && this.order.status !== "FILLED") {
      throw new Error(`Invariant violated: filled=quantity but status=${this.order.status}`);
    }

    // Balance never increases on execution
    if (this.account.balance > this.initialBalance) {
      throw new Error(`Invariant violated: balance increased (${this.account.balance} > ${this.initialBalance})`);
    }
  }

  /**
   * Clear seen cache (for testing replay scenarios)
   */
  clearCache() {
    this.seen.clear();
  }
}
