# Acme Appliances order ledger question API

This service accepts `POST` requests with `{"question":"..."}` and returns
`{"answer":...}`. It loads the ledger export and USD conversion rates at startup,
keeps the latest `updated_at` version of each order, and answers requests from
the in-memory ledger. Business dates are evaluated in `Asia/Kolkata`. Revenue
includes only orders whose current status is `paid`.

## Local run

Set `QUESTION_DATA_URL` to the complete question-data URL supplied for your
account. Keep the URL (including its quiz signature) private and do not commit it.
Then run:

```powershell
$env:QUESTION_DATA_URL = "paste your supplied questionData URL here"
npm start
```

The service listens on `http://localhost:3000`. Example request:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/" `
  -ContentType "application/json" `
  -Body '{"question":"What was total revenue in USD from the North region in March 2026?"}'
```

## Render deployment

The root `render.yaml` points Render at this folder and starts the service with
`npm start`. Set the `QUESTION_DATA_URL` environment variable in the Render
service settings to the full question-data URL provided for your account. Do not
put the URL in source control. Once deployed, submit the Render HTTPS service
URL with a trailing `/` (or `/api` or `/answer`); all three accept the same POST
request. Render terminates HTTPS and forwards requests to this Node.js service.

`GET /health` returns `{"status":"ok"}`.
