# Flowdesk QA - Trading Engine Test Suite

Production-grade test suite demonstrating modern DevOps, distributed systems patterns, and enterprise-level QA practices.

**Portfolio highlights**: Event-driven idempotency, Docker orchestration, CI/CD pipelines, integration testing, code coverage (98.55%)

---

## 🚀 Quick Start

### Prerequisites
- Node.js 22+
- Docker Desktop
- npm 10+

### 1. Unit Tests (30 sec)
```bash
npm install
npm test
npm run lint
```

### 2. Full Stack with Docker (2 min)
```bash
docker-compose up -d
npm run test:integration
docker-compose down
```

### 3. GitHub Actions
Push to `main` branch → automated unit + integration tests

---

## 📁 Project Structure

**See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed structure & design patterns.**

```
src/              Core application code (types, engine, order execution, WebSocket)
tests/
  ├── unit/       Vitest unit tests (40 passing)
  ├── integration/ Docker service tests (13 passing, Postgres + Redis)
  └── e2e/        Playwright API tests (2 passing, [TC_*] naming for Squash)
scripts/          Squash TM integration script
.github/workflows CI/CD pipeline configuration
docker-compose.yml Local service orchestration
```

---

## ✅ Test Summary

| Type | Count | Framework | Status |
|------|-------|-----------|--------|
| Unit | 40 | Vitest | ✅ All passing |
| Integration | 13 | Vitest + Docker | ✅ All passing |
| E2E | 2 | Playwright | ✅ All passing |
| **Total Coverage** | **98.55%** | - | ✅ |

---

## 🔑 Key Features

### 1. **Idempotency Verification**
- Client-side dedup cache (ExecutionConsumer helper)
- Server-side Redis caching (1h TTL)
- Comprehensive invariant assertions
- See `tests/helpers/executionConsumer.ts`

### 2. **Docker-Based Orchestration**
- PostgreSQL 16 database
- Redis 7 caching layer
- Mock trading engine (Node.js)
- Health checks with exponential backoff

### 3. **Enterprise Test Result Publishing**
- Squash TM integration via JUnit XML import
- `[TC_*]` test naming convention for Squash mapping
- Graceful skip if secrets not configured
- Run: `npm run publish:squash -- reports/junit-integration.xml`

### 4. **Multi-Stage CI Pipeline**
- Parallel unit + integration test jobs
- Automated JUnit report generation
- Artifact uploads for inspection
- Dashboard-ready test metrics

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Detailed structure, design patterns, onboarding checklist |
| [DOCKER_CI.md](DOCKER_CI.md) | Docker setup & CI troubleshooting |
| [E2E_README.md](E2E_README.md) | Playwright E2E testing guide |

---

## 🧪 NPM Scripts

```bash
# Testing
npm test                    # All unit tests
npm run test:unit           # Vitest only
npm run test:integration    # Docker services + integration tests
npm run test:e2e            # Playwright E2E tests
npm run test:junit          # Generate JUnit reports

# Quality
npm run lint                # ESLint validation
npm run lint:fix            # Auto-fix linting issues
npm run coverage            # Generate coverage report

# Local Development
npm run engine:start        # Start mock engine
npm run dev                 # Express server with hot reload

# Publishing
npm run publish:squash -- reports/junit-integration.xml  # Squash TM
```

---

## 🏗️ Architecture Highlights

### Service Orchestration Pattern
```
Server (Express) → Engine → Postgres
                         ↘ Redis (idempotency cache)
                         ↘ WebSocket (real-time updates)
```

### Idempotency Flow
1. Client sends request with `eventId`
2. Server checks Redis cache
3. If cached → return cached result (fast path)
4. If new → execute transaction + cache result (slow path)
5. Client-side consumer deduplicates via memory cache

### Testing Strategy
- **Unit tests**: Fast, isolated, no I/O
- **Integration tests**: Real services, full workflows
- **E2E tests**: Client API simulation (Playwright)

---

## 🐳 Docker Services

**docker-compose.yml** includes:
- PostgreSQL 16 (port 5432, user: app, pass: app)
- Redis 7 (port 6379)
- Mock Engine (port 8080 REST, 8081 WebSocket)

Health checks ensure services are ready before tests:
```bash
docker-compose ps
```

---

## 🔗 Example Requests

```bash
# Health check
curl http://localhost:8080/health

# Create order
curl -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -d '{"quantity": 100}'

# Execute order with idempotency
curl -X POST http://localhost:8080/execute \
  -H "Content-Type: application/json" \
  -d '{"orderId": "O-001", "quantity": 50, "eventId": "E-123"}'

# WebSocket real-time updates
wscat -c ws://localhost:8081
```

---

## 📈 Performance & Metrics

- **Unit tests**: ~200ms
- **Integration tests**: ~300ms
- **E2E tests**: ~800ms
- **Full CI pipeline**: ~2-3 minutes
- **Code coverage**: 98.55%
- **ESLint**: 0 errors

---

## 🎓 Interview Topics

This codebase demonstrates expertise in:

1. **Distributed Systems**
   - Idempotency patterns (client + server)
   - Eventual consistency with Redis cache
   - Event-driven architecture

2. **DevOps & CI/CD**
   - Docker Compose local development
   - GitHub Actions multi-job pipelines
   - Health checks & service dependencies

3. **Testing Strategies**
   - Unit vs. integration vs. E2E separation
   - Test pyramid & fixture management
   - Invariant assertions & property-based verification

4. **Software Engineering**
   - Separation of concerns (types → logic → services)
   - API contract testing
   - Production-ready code organization

---

## 🚦 CI/CD Status

Check GitHub Actions for latest test runs:
https://github.com/hessaoui/flowdesk-qa-ts/actions

---

## 📝 License

MIT - Feel free to use for portfolio or learning purposes.

---

## 🤝 Contributing

1. Fork the repo
2. Create feature branch (`git checkout -b feature/new-test`)
3. Run `npm run lint:fix` before committing
4. Run `npm test` to verify
5. Push and open PR

For detailed contribution guidelines, see [ARCHITECTURE.md#adding-new-tests](ARCHITECTURE.md#adding-new-tests).
