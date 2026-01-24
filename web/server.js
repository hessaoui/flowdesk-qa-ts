import http from "node:http";

const ENGINE_URL = process.env.ENGINE_URL || "http://localhost:8080";

const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Client Platform</title></head>
<body>
  <h1 data-testid="title">Flowdesk Client Platform (Demo)</h1>
  <button id="btn">Check Engine Health</button>
  <pre id="out" data-testid="health"></pre>

  <script>
    const out = document.getElementById("out");
    
    document.getElementById("btn").addEventListener("click", async () => {
      try {
        // Use same-origin request to avoid CORS issues
        const r = await fetch("/api/health");
        const data = await r.json();
        out.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        out.textContent = "Error: " + e.message;
      }
    });
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Proxy health endpoint
  if (req.url === "/api/health" && req.method === "GET") {
    try {
      const url = new URL("/health", ENGINE_URL);
      const response = await fetch(url.toString());
      const data = await response.json();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // Serve HTML
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, "0.0.0.0", () => console.log(`web listening on :${PORT}`));
