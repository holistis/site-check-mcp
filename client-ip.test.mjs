import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientIp } from './client-ip.mjs'

const req = (xff, remote = '127.0.0.1') => ({ socket: { remoteAddress: remote }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } })

test('without TRUST_PROXY the connecting address is used and the header is ignored', () => {
  assert.equal(clientIp(req('1.2.3.4'), false), '127.0.0.1')
})

test('with TRUST_PROXY the last entry counts, the one the proxy appended', () => {
  assert.equal(clientIp(req('203.0.113.7'), true), '203.0.113.7')
  assert.equal(clientIp(req('198.51.100.1, 203.0.113.7'), true), '203.0.113.7')
})

test('a client that writes its own first entry cannot choose its bucket', () => {
  const a = clientIp(req('9.9.9.9, 203.0.113.7'), true)
  const b = clientIp(req('8.8.8.8, 203.0.113.7'), true)
  assert.equal(a, b)
})

test('a header sent as an array is joined and the last entry still counts', () => {
  assert.equal(clientIp(req(['1.1.1.1', '2.2.2.2, 203.0.113.9']), true), '203.0.113.9')
})

test('ipv6 is accepted', () => {
  assert.equal(clientIp(req('2001:db8::1'), true), '2001:db8::1')
})

test('missing, empty or malformed headers fall back to the connecting address', () => {
  for (const h of [undefined, '', ' , ', 'not-an-ip', '1.2.3.4, <script>', '1.2.3.4,', '999.1.1.1']) {
    const got = clientIp(req(h), true)
    if (h === '1.2.3.4,') assert.equal(got, '1.2.3.4')
    else assert.equal(got, '127.0.0.1', JSON.stringify(h))
  }
})

test('a request without a socket does not throw', () => {
  assert.equal(clientIp({ headers: {} }, true), 'unknown')
  assert.equal(clientIp(undefined, false), 'unknown')
})
