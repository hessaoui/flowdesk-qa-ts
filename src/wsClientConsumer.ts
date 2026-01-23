import WebSocket from "ws";
import type { ExecutionEvent } from "./types.js";
import type { TradingEngine } from "./engine.js";

/**
 * WebSocket client that connects to a server and consumes execution events.
 * 
 * Automatically feeds events into the TradingEngine, which handles:
 * - Idempotency (duplicate detection)
 * - State validation
 * - Overfill prevention
 * 
 * Production considerations to discuss in interview:
 * - Reconnection with exponential backoff
 * - Heartbeat/ping-pong for connection health
 * - Message acknowledgment to guarantee processing
 * - Dead letter queue for malformed messages
 * - Circuit breaker pattern for cascading failures
 * - Metrics (latency, message rate, error rate)
 */
export function connectAndConsume(url: string, engine: TradingEngine) {
  const ws = new WebSocket(url);

  /**
   * Handle incoming messages from the WebSocket.
   * Parse JSON and apply execution events to the engine.
   */
  ws.on("message", (data) => {
    try {
      const evt = JSON.parse(data.toString()) as ExecutionEvent;
      if (evt.type === "execution") {
        const result = engine.applyExecution(evt);
        
        // In production, you'd log/monitor rejection reasons
        if (!result.applied && result.reason) {
          // console.warn(`Event ${evt.eventId} rejected: ${result.reason}`);
        }
      }
    } catch {
      // In production: log to monitoring system, increment error metric
      // For this demo, silently ignore malformed messages
    }
  });

  /**
   * Wait for the WebSocket connection to open.
   * Throws if connection fails.
   */
  function waitOpen() {
    return new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (e) => reject(e));
    });
  }

  /**
   * Gracefully close the WebSocket connection.
   */
  function close() {
    return new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      ws.close();
    });
  }

  return {
    ws,
    waitOpen,
    close,
  };
}
