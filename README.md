# Acme Appliances ledger question service

The Render Blueprint deploys the service in [`api-point`](./api-point/README.md).
It accepts `POST` JSON requests at the service root:

```json
{"question":"What was total revenue in USD from the North region in March 2026?"}
```

and responds with:

```json
{"answer":123.45}
```

To deploy, connect this GitHub repository to Render as a Blueprint and provide
the complete account-specific question-data URL when prompted for the
`QUESTION_DATA_URL` environment variable. Keep that URL private; it contains
the quiz signature. The public endpoint is the HTTPS URL Render assigns to the
service. No `/mcp` suffix is used for this API.
