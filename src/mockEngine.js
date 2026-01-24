/**
 * Mock Trading Engine Service
 * 
 * This simulates a production trading engine that:
 * - Provides HTTP API with health checks
 * - Publishes execution events over WebSocket
 * - Connects to Postgres for state
 * - Uses Redis for caching/idempotency
 * 
 * Interview talking points:
 * - Services: pattern allows testing against real external dependencies
 * - Health checks enable CI to know when service is ready
 * - env vars (DATABASE_URL, REDIS_URL) show 12-factor app config
 * - Separate ports: HTTP (8080) vs WebSocket (8081)
 */

import http from "node:http";
import { WebSocketServer } from "ws";
import postgres from "pg";
import redis from "redis";

const PORT_HTTP = 8080;
const PORT_WS = 8081;

const dbUrl = process.env.DATABASE_URL || "postgres://app:app@localhost:5432/app_test";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

let pgClient = null;
let redisClient = null;
let wsClients = new Set();

/**
 * Initialize database connection with retry logic
 */
async function initPostgres() {
  const pool = new postgres.Pool({ connectionString: dbUrl });
  
  // Wait for connection with retries
  let attempts = 0;
  while (attempts < 10) {
    try {
      const client = await pool.connect();
      await client.query("SELECT NOW()");
      client.release();
      console.log("✓ PostgreSQL connected");
      return pool;
    } catch {
      attempts++;
      console.log(`PostgreSQL connection attempt ${attempts}/10 failed, retrying...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error("Failed to connect to PostgreSQL");
}

/**
 * Initialize Redis connection with retry logic
 */
async function initRedis() {
  const client = redis.createClient({ url: redisUrl });
  
  let attempts = 0;
  while (attempts < 10) {
    try {
      client.on("error", () => {}); // Suppress errors during initial connect
      await client.connect();
      console.log("✓ Redis connected");
      return client;
    } catch {
      attempts++;
      console.log(`Redis connection attempt ${attempts}/10 failed, retrying...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error("Failed to connect to Redis");
}

/**
 * Create HTTP server with health check and execution endpoints
 */
function createHttpServer() {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Content-Type", "application/json");

    // Health check endpoint
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        postgres: pgClient ? "connected" : "disconnected",
        redis: redisClient ? "connected" : "disconnected",
        wsClients: wsClients.size,
      }));
      return;
    }

    // GET /orders - list orders from database (integration test endpoint)
    if (req.method === "GET" && req.url === "/orders") {
      try {
        const result = await pgClient.query(
          "SELECT id, quantity, filled_quantity, status FROM orders ORDER BY id"
        );
        res.writeHead(200);
        res.end(JSON.stringify({ orders: result.rows }));
      } catch (e) {
        console.error("GET /orders error:", e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /orders - create order (integration test endpoint)
    if (req.method === "POST" && req.url === "/orders") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const { quantity, side } = JSON.parse(body);
          const orderId = `ORD-${Date.now()}`;
          
          await pgClient.query(
            "INSERT INTO orders (id, quantity, filled_quantity, status, side) VALUES ($1, $2, 0, 'OPEN', $3)",
            [orderId, quantity, side || "BUY"]
          );

          res.writeHead(201);
          res.end(JSON.stringify({ orderId, quantity, status: "OPEN" }));
        } catch (e) {
          console.error("POST /orders error:", e.message);
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /execute - simulate execution event (integration test endpoint)
    if (req.method === "POST" && req.url === "/execute") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const { orderId, quantity } = JSON.parse(body);
          const eventId = `EXE-${Date.now()}`;

          // Check idempotency cache in Redis
          const cacheKey = `execution:${eventId}`;
          const cached = await redisClient.get(cacheKey);
          if (cached) {
            res.writeHead(200);
            res.end(JSON.stringify({ applied: false, reason: "duplicate", eventId }));
            return;
          }

          // Store in Redis with 1 hour TTL
          await redisClient.setEx(cacheKey, 3600, "1");

          // Update order in database
          await pgClient.query(
            "UPDATE orders SET filled_quantity = filled_quantity + $1 WHERE id = $2",
            [quantity, orderId]
          );

          // Get updated order
          const result = await pgClient.query(
            "SELECT * FROM orders WHERE id = $1",
            [orderId]
          );

          const order = result.rows[0];
          if (order.filled_quantity >= order.quantity) {
            await pgClient.query(
              "UPDATE orders SET status = 'FILLED' WHERE id = $1",
              [orderId]
            );
          } else if (order.filled_quantity > 0) {
            await pgClient.query(
              "UPDATE orders SET status = 'PARTIALLY_FILLED' WHERE id = $1",
              [orderId]
            );
          }

          // Broadcast execution event to all WebSocket clients
          const event = JSON.stringify({
            type: "execution",
            eventId,
            orderId,
            executedQuantity: quantity,
            timestamp: Date.now(),
          });

          wsClients.forEach(client => {
            if (client.readyState === 1) { // OPEN
              client.send(event);
            }
          });

          res.writeHead(200);
          res.end(JSON.stringify({ applied: true, eventId, order }));
        } catch (e) {
          console.error("POST /execute error:", e.message);
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return server;
}

/**
 * Create WebSocket server for streaming execution events
 */
function createWsServer() {
  const wss = new WebSocketServer({ port: PORT_WS });

  wss.on("connection", (ws) => {
    console.log(`WebSocket client connected (total: ${wsClients.size + 1})`);
    wsClients.add(ws);

    ws.on("message", (data) => {
      // Echo messages for testing
      console.log(`WebSocket message received: ${data}`);
      ws.send(JSON.stringify({ type: "ack", message: data.toString() }));
    });

    ws.on("close", () => {
      wsClients.delete(ws);
      console.log(`WebSocket client disconnected (total: ${wsClients.size})`);
    });

    ws.on("error", (e) => {
      console.error("WebSocket error:", e.message);
      wsClients.delete(ws);
    });
  });

  return wss;
}

/**
 * Initialize database schema
 */
async function initSchema() {
  try {
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(50) PRIMARY KEY,
        quantity INTEGER NOT NULL,
        filled_quantity INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        side VARCHAR(10) NOT NULL DEFAULT 'BUY',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id VARCHAR(50) PRIMARY KEY,
        balance NUMERIC(20, 2) NOT NULL DEFAULT 1000.00,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("✓ Database schema initialized");
  } catch (e) {
    console.error("Schema init warning (may already exist):", e.message);
  }
}

/**
 * Start the engine service
 */
async function start() {
  try {
    console.log("🚀 Starting Mock Trading Engine...");
    
    // Connect to external services
    pgClient = await initPostgres();
    redisClient = await initRedis();
    
    // Initialize schema
    await initSchema();

    // Start HTTP server
    const httpServer = createHttpServer();
    httpServer.listen(PORT_HTTP, () => {
      console.log(`✓ HTTP server listening on port ${PORT_HTTP}`);
      console.log(`  Health check: http://localhost:${PORT_HTTP}/health`);
    });

    // Start WebSocket server
    const wsServer = createWsServer();
    wsServer.on("listening", () => {
      console.log(`✓ WebSocket server listening on port ${PORT_WS}`);
    });

    console.log("\n✅ Mock Trading Engine ready");
  } catch (e) {
    console.error("❌ Failed to start engine:", e.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  if (pgClient) await pgClient.end();
  if (redisClient) await redisClient.quit();
  process.exit(0);
});

start();
