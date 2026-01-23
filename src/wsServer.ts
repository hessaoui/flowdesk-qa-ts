import { WebSocketServer, WebSocket } from "ws";
import type { ExecutionEvent } from "./types.js";

/**
 * Minimal WebSocket server for broadcasting execution events.
 * 
 * In production, this would be more sophisticated:
 * - Authentication/authorization
 * - Per-client subscriptions (not broadcast to all)
 * - Backpressure handling
 * - Reconnection logic
 * - Message acknowledgments
 * - Metrics/monitoring
 */
export function startWsServer(port = 0) {
  const wss = new WebSocketServer({ port });

  /**
   * Broadcast an event to all connected clients.
   * Uses JSON serialization (in production, consider Protocol Buffers/MessagePack)
   */
  function broadcast(event: ExecutionEvent) {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Get the actual port the server is listening on.
   * Useful when using port 0 (auto-assign) for testing.
   */
  function port(): number {
    const addr = wss.address();
    if (typeof addr === "object" && addr) return addr.port;
    throw new Error("Cannot get server port");
  }

  /**
   * Gracefully close the server.
   */
  function close() {
    return new Promise<void>((resolve, reject) => {
      wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return {
    wss,
    port,
    broadcast,
    close,
  };
}
