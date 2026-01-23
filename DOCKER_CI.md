# Docker-Based CI Integration Testing

This project demonstrates a production-grade CI pipeline using GitHub Actions with containerized dependencies.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│         GitHub Actions CI Workflow (ubuntu-latest)       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Job 1: unit-tests        Job 2: integration-tests      │
│  ├─ ESLint                ├─ Postgres:16                │
│  ├─ Vitest (unit)         ├─ Redis:7                    │
│  └─ JUnit reporting       ├─ Mock Engine (Node.js)      │
│                           └─ TypeScript Integration     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Services Pattern

This pipeline uses `services:` in GitHub Actions to provide:

1. **Postgres:16** - State persistence (orders, accounts)
2. **Redis:7** - Idempotency caching with TTL
3. **Mock Engine** - HTTP/WebSocket API simulating the trading engine

### Container Networking

- **From runner steps**: Services accessible via `localhost:<port>`
- **Between containers**: Services reference each other by name
  - `postgres` (internal), `redis` (internal)
  - `localhost:5432` (from runner)

### Health Checks

Each service includes health checks:

```yaml
options: >-
  --health-cmd="pg_isready -U app -d app_test"
  --health-interval=5s
  --health-timeout=3s
  --health-retries=20
```

This ensures CI waits up to 100 seconds before declaring services ready.

### Defensive Wait Loops

Even with health checks, the workflow includes explicit wait steps:

```bash
# Wait for Postgres
for i in {1..30}; do
  pg_isready -h localhost -p 5432 -U app -d app_test && exit 0
  sleep 2
done
```

**Why both?** Reduces test flakiness—sometimes services report "healthy" before they're truly ready.

## Environment Variables

The workflow passes service URLs to tests via environment variables:

```bash
DATABASE_URL: postgres://app:app@localhost:5432/app_test
REDIS_URL: redis://localhost:6379
API_BASE_URL: http://localhost:8080
WS_URL: ws://localhost:8081
```

Tests read these at runtime:

```typescript
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8080";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
```

## Running Integration Tests Locally

### Prerequisites

```bash
# Start Docker (Docker Desktop or daemon)
docker version  # Verify Docker is running

# Install dependencies
npm ci
```

### Option 1: Start Services Manually + Run Tests

```bash
# Terminal 1: Start services
docker-compose up -d postgres redis

# Terminal 2: Start mock engine
npm run engine:start

# Terminal 3: Run integration tests
npm run test:integration
```

### Option 2: Run with docker-compose (recommended)

```bash
# Create docker-compose.yml in project root (see below)
docker-compose up --abort-on-container-exit --exit-code-from test
```

### Option 3: GitHub Actions (real CI)

```bash
git push origin main
# GitHub Actions automatically runs full pipeline
```

## Mock Engine Service

The mock engine (`src/mockEngine.js`) simulates a production trading system:

**HTTP Endpoints:**
- `GET /health` - System status (postgres, redis, connected clients)
- `GET /orders` - List all orders
- `POST /orders` - Create order (accepts `{ quantity, side }`)
- `POST /execute` - Execute order (accepts `{ orderId, quantity }`)

**WebSocket:**
- `WS://localhost:8081` - Subscribe to execution events

**Key Features:**
- Connects to Postgres for durable state
- Uses Redis for idempotency caching (1-hour TTL)
- Broadcasts execution events to all connected WebSocket clients
- Demonstrates 12-factor app patterns (env vars, health checks)

## Integration Tests

Tests are in `tests/integration/engine.spec.ts` and validate:

1. **HTTP API** - Health checks, CRUD operations
2. **State Persistence** - Postgres queries within tests
3. **Idempotency** - Redis cache behavior
4. **Event Streaming** - WebSocket message delivery
5. **Resilience** - Concurrent requests, service coordination

### Example Test

```typescript
it("persists order to Postgres", async () => {
  // Create order via HTTP API
  const createResponse = await fetch(`${API_BASE_URL}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity: 50, side: "SELL" }),
  });
  const created = await createResponse.json();
  const orderId = created.orderId;

  // Verify directly in Postgres
  const result = await pgPool.query(
    "SELECT * FROM orders WHERE id = $1",
    [orderId]
  );

  expect(result.rows[0].quantity).toBe(50);
  expect(result.rows[0].status).toBe("OPEN");
});
```

## Interview Talking Points

### 1. Services Pattern

> "I use `services:` in GitHub Actions to spin up real dependencies—Postgres, Redis, and a mock engine—on the same network as the test runner. This allows testing the full integration without mocks."

### 2. Health Checks + Wait Loops

> "I include both Docker health checks and explicit wait loops in the workflow. Health checks make CI scalable, but wait loops catch cases where services report ready before they're truly stable."

### 3. Environment Variables

> "All service URLs are passed via environment variables (DATABASE_URL, REDIS_URL, API_BASE_URL). This follows 12-factor app patterns and makes tests portable—same code runs locally and in CI."

### 4. Idempotency in Distributed Systems

> "The mock engine stores execution IDs in Redis with a 1-hour TTL. Tests verify that duplicate event IDs (simulating network retries) are detected and skipped—critical for at-least-once delivery semantics."

### 5. Test Isolation

> "Each test truncates the test database before running. This ensures isolation and prevents flaky tests from test ordering."

## Troubleshooting

### "Services not ready" timeout

1. Check Docker daemon is running: `docker ps`
2. Verify ports aren't already in use: `lsof -i :5432`
3. Check logs: `docker logs <container_id>`

### "Connection refused" in tests

- Ensure you're using `localhost` (not `127.0.0.1`) in URLs
- Verify environment variables: `echo $DATABASE_URL`
- Check service is listening: `curl http://localhost:8080/health`

### "Test database already exists"

The mock engine creates schema on startup. If running multiple times:

```bash
# Drop test database
docker exec -it postgres psql -U app -d postgres -c "DROP DATABASE app_test;"
```

## Next Steps

To extend this setup:

1. **Real Rust Engine** - Replace mock engine with actual Rust service
   ```yaml
   engine:
     image: ghcr.io/your-org/trading-engine:latest
   ```

2. **Performance Tests** - Add load testing against services
   ```bash
   npm run test:load
   ```

3. **Security Scanning** - Add container image scanning
   ```yaml
   - uses: aquasecurity/trivy-action@master
   ```

4. **Database Migrations** - Use Flyway or Liquibase before tests
   ```bash
   - name: Run migrations
     run: |
       flyway -url=jdbc:postgresql://localhost:5432/app_test \
         -user=app -password=app migrate
   ```

## Resources

- [GitHub Actions Services](https://docs.github.com/en/actions/using-containerized-services)
- [Docker Health Checks](https://docs.docker.com/engine/reference/builder/#healthcheck)
- [PostgreSQL Docker Image](https://hub.docker.com/_/postgres)
- [Redis Docker Image](https://hub.docker.com/_/redis)
