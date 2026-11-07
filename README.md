# site-check-mcp

One-off real-browser check of a single URL, over MCP. No subscription, no
setup, no GitHub Actions to configure — pay per call, get a report back in
seconds.

**Cost:** $0.02 USDC on Base (eip155:8453) via [x402](https://www.x402.org/).
No API key, no signup.

## What you get back

A single tool call visits the URL with a real headless Chromium browser and
returns:

- `reachable` and `http_status`
- `load_time_ms`
- page `title`
- `console_errors`, `console_warnings` — real browser console output
- `js_exceptions` — uncaught JS errors
- `page_appears_empty` — a cheap signal for a blank/broken render

This is the on-demand sibling of
[muraqib](https://github.com/holistis/muraqib), which does the same kind of
check but nightly, continuously, against your own repo via GitHub Actions.
Use muraqib if you want ongoing monitoring with auto-fix PRs. Use
site-check-mcp if you just want to check one URL, right now, once.

## Security

The service validates the URL before it visits the page. Without a payment
attached you get the payment instructions first.

This server only forwards your call. When you run it yourself behind a reverse
proxy, set `TRUST_PROXY=1` so the rate limit counts each visitor separately,
and only do that when exactly one proxy sits in front and appends the
connecting address to `X-Forwarded-For` (nginx with
`$proxy_add_x_forwarded_for` does). With `TRUST_PROXY=1` the server listens on
`127.0.0.1` only, unless you set `HOST`.

To report a security problem, see [SECURITY.md](SECURITY.md).

## Quick start (Claude Desktop / Claude Code)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "site-check": {
      "url": "https://wazir-x402.duckdns.org/site-check-mcp"
    }
  }
}
```

Or call the tool directly:

```
check_site({ url: "https://example.com" })
```

The first call (no payment) returns the x402 payment instructions — the
wallet address and exact amount to send. Send the USDC payment, then call
again with the transaction hash as `payment_signature` to get the real
report.

## HTTP API (no MCP client needed)

The same check is also available as a plain HTTP endpoint:

```
POST https://api.mergefix.com/api/site-check
Content-Type: application/json

{ "url": "https://example.com" }
```

See [api.mergefix.com/openapi.json](https://api.mergefix.com/openapi.json)
for the full spec, alongside the other endpoints on the same tollbooth
(smart contract vulnerability search, audit signals, a bug bounty finding
judge).

## Payment without crypto

No wallet? A Stripe (card / iDEAL) alternative is offered on the same 402
response once available — check the `stripe_alternative` field.

## License

MIT.
