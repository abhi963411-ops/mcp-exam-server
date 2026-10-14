# MCP Exam Challenge Server

A minimal Node.js MCP server exposing exactly one tool: `solve_challenge`.

## Requirements
- Node.js 20 or newer
- No third-party npm packages required

## Run locally
1. Open this folder in VS Code.
2. Open **Terminal → New Terminal**.
3. Run `npm start`.
4. The server listens at `http://localhost:3000/mcp` unless the host sets `PORT`.

## Test from Windows PowerShell
Open a second terminal and run this block:

```powershell
$challenge = "0123456789abcdef0123456789abcdef"

$body = @{
  jsonrpc = "2.0"
  id = 1
  method = "tools/call"
  params = @{ name = "solve_challenge"; arguments = @{} }
} | ConvertTo-Json -Depth 10

$response = Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/mcp" `
  -ContentType "application/json" `
  -Headers @{ "X-Exam-Challenge" = $challenge } `
  -Body $body

$actual = $response.result.content[0].text
$expected = node -e "const c=require('node:crypto'); console.log(c.createHash('sha256').update('$challenge:22f3003081@ds.study.iitm.ac.in').digest('hex').slice(0,16))"
"Actual:   $actual"
"Expected: $expected"
"Match:    $($actual -eq $expected)"
```

The last line should say `Match: True`. Test a second challenge as well.

## Protocol behavior
- `initialize` returns server capabilities.
- `notifications/initialized` is accepted with HTTP 202 and no body.
- `tools/list` returns exactly one tool named `solve_challenge`.
- `tools/call` reads `X-Exam-Challenge` from the current HTTP headers and returns the first 16 lowercase hex characters of `SHA-256("${challenge}:22f3003081@ds.study.iitm.ac.in")`.
- The tool schema has no `required` properties.
- Timestamp and signature verification are omitted because they are optional in the assignment.

## Deploy to Render
1. Create a GitHub repository and upload `server.js`, `package.json`, and this README.
2. In Render, create a **New Web Service** and connect the repository.
3. Choose Node; set build command to `npm install` and start command to `npm start`.
4. Deploy and wait for Render to mark the service live.
5. Your MCP endpoint is the actual Render HTTPS base URL plus `/mcp`, e.g. `https://your-service.onrender.com/mcp` (example only).
6. Run the PowerShell test again with the public URL instead of localhost. Also test `initialize` and `tools/list` against that URL.
7. Keep the service available through the grading window. Some free plans sleep when idle; check your host's plan and availability.

## Important
This package contains the server project but does not create a GitHub repository or deploy a live service. Do not submit a URL until you have deployed and tested the public HTTPS endpoint.
