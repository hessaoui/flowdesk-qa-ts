export type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED";

export interface Order {
  id: string;
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
}

export interface Account {
  balance: number;
}

/**
 * WebSocket execution event structure.
 * eventId is mandatory for deduplication (idempotency key).
 * 
 * Real-world considerations:
 * - eventId ensures at-least-once delivery doesn't cause double-fills
 * - timestamp could be added for ordering/debugging
 * - price field would be needed for real executions
 */
export interface ExecutionEvent {
  type: "execution";
  eventId: string;        // unique execution identifier (idempotency key)
  orderId: string;
  executedQuantity: number;
}
