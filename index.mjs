#!/usr/bin/env node
// site-check-mcp.mjs — MCP-server (streamable HTTP) die het al-live, al-geteste
// betaalde /api/site-check-endpoint op api.mergefix.com aan AI-agents aanbiedt als
// één losstaand gereedschap: check_site. Puur een dunne doorgeefluik, GEEN eigen
// betaal- of controlelogica hier — die staat al, bewezen, in x402-server.mjs.
// Zelfde patroon als capacity-attest-http (tokenizen), hergebruikt.
//
// DE 4 VERPLICHTE CHECKS (globale CLAUDE.md, publicatiepoort voor netwerk-code):
// 1. Auth-check: geen auth nodig, dit endpoint verzint geen eigen bevoegdheden,
//    het geeft letterlijk door wat het echte, betaal-bewakende endpoint teruggeeft.
// 2. Data-check: url-parameter wordt NIET hier gevalideerd (dat gebeurt al, hard,
//    in site-check.mjs op de echte server, met een SSRF-slot), dit bestand stuurt
//    de invoer gewoon door zonder er zelf iets mee te doen.
// 3. Exposure-check: geen geheimen in dit proces. Fouten van de upstream-aanroep
//    worden kort samengevat teruggegeven, nooit de ruwe interne foutmelding.
// 4. Rate-check: dezelfde in-memory per-IP-limiet als capacity-attest-http.
import { createServer, request as httpsRequestNode } from 'node:http'
import https from 'node:https'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { clientIp } from './client-ip.mjs'

const PORT = Number(process.env.PORT ?? 8403)
const UPSTREAM_HOST = 'api.mergefix.com'
const UPSTREAM_PATH = '/api/site-check'
const MAX_BODY_BYTES = 8 * 1024

function textResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text', text }] }
}
function errorResult(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

function callUpstream(url, paymentSignature) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ url })
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    if (paymentSignature) headers['X-PAYMENT'] = paymentSignature
    const req = https.request(
      { host: UPSTREAM_HOST, path: UPSTREAM_PATH, method: 'POST', headers, timeout: 30000 },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(data) }) }
          catch { resolve({ status: res.statusCode, json: { error: 'Onverwachte upstream-respons' } }) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('upstream timeout')) })
    req.write(body)
    req.end()
  })
}

function buildServer() {
  const server = new McpServer({ name: 'site-check-mcp', version: '1.0.0' })

  server.registerTool(
    'check_site',
    {
      title: 'One-off real-browser check of a single URL ($0.02 USDC via x402)',
      description:
        'Visits a URL with a real headless browser and returns HTTP status, load time, page title, JS console errors, ' +
        'console warnings and uncaught exceptions. Paid per call ($0.02 USDC on Base, x402). ' +
        'Call WITHOUT payment_signature first to receive the payment instructions (wallet address, exact amount). ' +
        'After paying, call again with the transaction hash as payment_signature to receive the actual report. ' +
        'The URL is validated before the page is visited. Without a payment you receive the payment instructions first.',
      inputSchema: {
        url: z.string().describe('The URL to check, e.g. https://example.com'),
        payment_signature: z.string().optional().describe('Base USDC transaction hash (0x...) after paying $0.02, or an x402 X-PAYMENT payload. Omit to receive payment instructions.'),
      },
    },
    async ({ url, payment_signature }) => {
      try {
        const result = await callUpstream(url, payment_signature)
        return textResult(result.json)
      } catch (e) {
        return errorResult(e.message.slice(0, 200))
      }
    }
  )
  return server
}

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 30
const rateBuckets = new Map()
function isRateLimited(ip) {
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT_MAX_REQUESTS
}
setInterval(() => {
  const now = Date.now()
  for (const [ip, bucket] of rateBuckets) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) rateBuckets.delete(ip)
  }
}, RATE_LIMIT_WINDOW_MS).unref()

async function readBoundedBody(req, maxBytes) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) throw new Error(`request body exceeded ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

function createApp() {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id')
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
    if (req.url !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }))
      return
    }
    const ip = clientIp(req)
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' })
        .end(JSON.stringify({ error: 'rate limit exceeded, max 30 requests per minute' }))
      return
    }
    let parsedBody
    try {
      const raw = await readBoundedBody(req, MAX_BODY_BYTES)
      parsedBody = raw.length > 0 ? JSON.parse(raw) : undefined
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid request body' }))
      return
    }
    try {
      const server = buildServer()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on('close', () => { transport.close(); server.close() })
      await server.connect(transport)
      await transport.handleRequest(req, res, parsedBody)
    } catch (e) {
      console.error(`site-check-mcp: request ${randomUUID()} failed:`, e)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'internal error' }))
      }
    }
  }
}

const httpServer = createServer(createApp())
// With TRUST_PROXY=1 the server is meant to sit behind one local reverse proxy, so it only listens on loopback unless HOST says otherwise.
const HOST = process.env.HOST ?? (process.env.TRUST_PROXY === '1' ? '127.0.0.1' : undefined)
httpServer.listen(PORT, HOST, () => {
  console.log(`site-check-mcp listening on :${PORT}, POST /mcp (tool: check_site)`)
})
