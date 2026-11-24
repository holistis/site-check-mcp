import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.mjs')

// Starts the server over stdio, sends the frames a directory sends (initialize, initialized, tools/list) and returns what came back.
function vraagOverStdio(args, { wachtMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INDEX, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let uit = ''
    let fout = ''
    const frames = []
    const klaar = setTimeout(() => { child.kill(); reject(new Error('geen antwoord binnen de tijd; stdout: ' + uit.slice(0, 300) + ' stderr: ' + fout.slice(0, 300))) }, wachtMs)
    child.stdout.on('data', (d) => {
      uit += d
      let i
      while ((i = uit.indexOf('\n')) >= 0) {
        const regel = uit.slice(0, i); uit = uit.slice(i + 1)
        if (regel.trim()) frames.push(regel)
        if (frames.some((f) => { try { return JSON.parse(f).id === 2 } catch { return false } })) { clearTimeout(klaar); child.kill(); resolve(frames) }
      }
    })
    child.stderr.on('data', (d) => { fout += d })
    child.on('error', reject)
    const stuur = (o) => child.stdin.write(JSON.stringify(o) + '\n')
    stuur({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stdio-test', version: '0.0.0' } } })
    setTimeout(() => {
      stuur({ jsonrpc: '2.0', method: 'notifications/initialized' })
      stuur({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    }, 400)
  })
}

test('over stdio meldt de server zijn tool check_site met een verplichte url', async () => {
  const frames = await vraagOverStdio(['--stdio'])
  const lijst = frames.map((f) => JSON.parse(f)).find((f) => f.id === 2)
  assert.ok(lijst?.result?.tools, 'tools/list gaf geen tools')
  const tool = lijst.result.tools.find((t) => t.name === 'check_site')
  assert.ok(tool, 'check_site ontbreekt')
  assert.ok(tool.description.includes('x402'), 'de beschrijving noemt de betaling niet')
  assert.deepEqual(tool.inputSchema.required, ['url'], 'alleen url is verplicht, payment_signature is optioneel')
})

test('over stdio staat er op stdout alleen protocol: elke regel is JSON-RPC', async () => {
  const frames = await vraagOverStdio(['--stdio'])
  assert.ok(frames.length >= 2)
  for (const f of frames) {
    const o = JSON.parse(f)
    assert.equal(o.jsonrpc, '2.0', 'een regel op stdout die geen JSON-RPC is: ' + f.slice(0, 80))
  }
  assert.ok(!frames.some((f) => f.includes('listening')), 'het opstartbericht van de HTTP-modus staat op stdout')
})

test('MCP_TRANSPORT=stdio werkt als alternatief voor de vlag', async () => {
  const frames = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INDEX], { env: { ...process.env, MCP_TRANSPORT: 'stdio' }, stdio: ['pipe', 'pipe', 'ignore'] })
    let uit = ''
    const t = setTimeout(() => { child.kill(); reject(new Error('geen antwoord')) }, 8000)
    child.stdout.on('data', (d) => { uit += d; if (uit.includes('"id":1')) { clearTimeout(t); child.kill(); resolve(uit) } })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n')
  })
  assert.ok(frames.includes('"serverInfo"') && frames.includes('site-check-mcp'))
})
