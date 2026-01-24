import http from "node:http";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

// @ts-check

/**
 * @typedef {"OPEN" | "PARTIALLY_FILLED" | "FILLED"} OrderStatus
 * @typedef {{ id: string; quantity: number; filledQuantity: number; status: OrderStatus }} Order
 * @typedef {{ type: "execution"; eventId: string; orderId: string; executedQuantity: number }} ExecutionEvent
 */

/** @type {Map<string, Order>} */
const orders = new Map();
/** @type {Set<string>} */
const processedEventIds = new Set();

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @returns {void}
 */
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });

  if (req.method === "POST" && req.url === "/orders") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        const body = JSON.parse(raw || "{}");
        const id = String(body.id ?? randomUUID());
        const quantity = Number(body.quantity ?? 10);

        /** @type {Order} */
        const order = { id, quantity, filledQuantity: 0, status: "OPEN" };
        orders.set(id, order);
        return json(res, 201, order);
      } catch {
        return json(res, 400, { error: "invalid_json" });
      }
    });
    return;
  }

  json(res, 404, { error: "not_found" });
});

const wss = new WebSocketServer({ noServer: true });

/**
 * @param {ExecutionEvent} evt
 * @returns {void}
 */
function broadcast(evt) {
  const payload = JSON.stringify(evt);
  console.log(`Broadcasting execution event to ${wss.clients.size} clients:`, evt.eventId);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

/**
 * @param {ExecutionEvent} evt
 * @returns {{ applied: boolean; reason: string | undefined }}
 */
function applyExecution(evt) {
  if (processedEventIds.has(evt.eventId)) return { applied: false, reason: "duplicate_event" };

  const order = orders.get(evt.orderId);
  if (!order) return { applied: false, reason: "unknown_order" };
  if (evt.executedQuantity <= 0) return { applied: false, reason: "invalid_executed_quantity" };
  if (order.status === "FILLED") return { applied: false, reason: "already_filled" };

  const remaining = order.quantity - order.filledQuantity;
  const effectiveQty = Math.min(evt.executedQuantity, remaining);

  order.filledQuantity += effectiveQty;
  order.status = order.filledQuantity === order.quantity ? "FILLED" : "PARTIALLY_FILLED";

  processedEventIds.add(evt.eventId);

  // broadcast after applying (what clients observe)
  broadcast(evt);

  return { applied: true, reason: effectiveQty < evt.executedQuantity ? "capped_overfill" : undefined };
}

wss.on("connection", (ws) => {
  console.log(`New WS client connected, total clients: ${wss.clients.size}`);
  ws.send(JSON.stringify({ type: "hello", ok: true }));
});

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

// Simple endpoint-less "execution injector" via timer (for demo)
// Realistic in CI: tests will POST /orders then connect WS and locally trigger event generation.
// We provide a debug route-like behavior: if an order exists, emit executions every 200ms.
setInterval(() => {
  // emit nothing if no orders
  const first = /** @type {Order | undefined} */ (orders.values().next().value);
  if (!first) return;

  // create a deterministic duplicate sometimes
  const baseId = `E-${first.id}-${first.filledQuantity}`;
  /** @type {ExecutionEvent} */
  const evt = { type: "execution", eventId: baseId, orderId: first.id, executedQuantity: 3 };
  applyExecution(evt);

  // duplicate send (same eventId) every other tick
  if (first.filledQuantity % 2 === 0) applyExecution(evt);
}, 200);

const PORT = Number(process.env.PORT ?? 8080);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`engine listening on :${PORT}`);
});
