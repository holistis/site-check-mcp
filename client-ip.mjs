import net from 'node:net'

/**
 * Which address counts as "the client" for the per-IP rate limit.
 *
 * Without TRUST_PROXY the connecting address is used. Behind a reverse proxy that is the proxy itself, so every
 * visitor would share one bucket; that is why TRUST_PROXY=1 exists. Set it only when exactly one proxy sits in
 * front and appends the connecting address to X-Forwarded-For (nginx with $proxy_add_x_forwarded_for does).
 * The LAST entry is then the address that proxy saw. Earlier entries are written by the client and can be anything,
 * so they are never used. A last entry that is not an IP address falls back to the connecting address.
 */
export function clientIp(req, trustProxy = process.env.TRUST_PROXY === '1') {
  const direct = req?.socket?.remoteAddress ?? 'unknown'
  if (!trustProxy) return direct
  const raw = req?.headers?.['x-forwarded-for']
  const text = Array.isArray(raw) ? raw.join(',') : raw
  if (typeof text !== 'string') return direct
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean)
  const last = parts[parts.length - 1]
  return last && net.isIP(last) ? last : direct
}
