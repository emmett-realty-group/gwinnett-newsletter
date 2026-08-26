const http = require("http");
const { approve } = require("./newsletter-approval");
const port = Number(process.env.APPROVAL_PORT || 8787);
http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method !== "GET" || requestUrl.pathname !== "/approve") { res.writeHead(404); return res.end("Not found"); }
  try {
    const result = approve({ issueDate: requestUrl.searchParams.get("issue"), token: requestUrl.searchParams.get("token") });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(`<!doctype html><html><body><h1>Newsletter approved</h1><p>${result.record.issueDate} is APPROVED.</p><p>No assistant or subscriber email was sent.</p></body></html>`);
  } catch (error) { res.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); res.end(`Approval rejected: ${error.message}`); }
}).listen(port, "127.0.0.1", () => console.log(`Approval endpoint listening on http://127.0.0.1:${port}`));
