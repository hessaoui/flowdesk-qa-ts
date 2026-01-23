export type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED";
export type OrderSide = "BUY" | "SELL";

export interface Order {
  id: string;
  side: OrderSide;
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
  _lastExecution?: { quantity: number; timestamp: number }; // Track last execution for duplicate detection
}

export interface Account {
  balance: number;
}

export function executeOrder(order: Order, account: Account, executedQuantity: number): void {
  const now = Date.now();
  
  // Detect duplicate execution: same quantity within 100ms time window
  if (order._lastExecution?.quantity === executedQuantity && now - order._lastExecution.timestamp < 100) {
    return;
  }

  // Prevent overfill by capping to remaining quantity
  const actualQuantity = Math.min(executedQuantity, order.quantity - order.filledQuantity);

  // Execute only if there's quantity to fill
  if (actualQuantity > 0) {
    order.filledQuantity += actualQuantity;
    // BUY orders decrease balance (spending), SELL orders increase balance (receiving)
    account.balance += order.side === "BUY" ? -actualQuantity : actualQuantity;
    order._lastExecution = { quantity: executedQuantity, timestamp: now };
  }

  // Update status based on fill progress
  order.status = order.filledQuantity >= order.quantity ? "FILLED" 
               : order.filledQuantity > 0 ? "PARTIALLY_FILLED" 
               : "OPEN";
}