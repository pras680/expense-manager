// A local CONNECT-accepting HTTPS relay for Playwright's Chromium to use as
// its proxy in sandboxed environments where outbound traffic is only
// reachable through an HTTP forward proxy (this session's agent proxy,
// exposed via HTTPS_PROXY).
//
// Why this exists: Chromium's own CONNECT-tunnel client does not get a
// clean run through that forward proxy — every external host tested (not
// just Supabase) fails a few seconds into the TLS handshake with
// ERR_CONNECTION_RESET, while curl and Node's own https client sail
// through the identical proxy for the identical hosts. The only
// distinguishing factor found was the shape of the two clients' TLS
// ClientHellos — Chromium's is roughly 4x the size of curl's/Node's. Rather
// than chase that further, this relay sidesteps it: it terminates TLS
// itself (self-signed, generated per-hostname on the fly — Playwright is
// told to ignore cert errors, since this is a local trusted relay, not a
// real MITM of untrusted traffic) so Chromium only ever speaks TLS to
// 127.0.0.1, then re-issues the decrypted request upstream using Node's
// https client through HttpsProxyAgent — the exact client/agent combo
// confirmed above to work through this proxy.
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { generate as generateCert } from 'selfsigned'
import { HttpsProxyAgent } from 'https-proxy-agent'

// Certs are generated once per hostname and cached — SNICallback below needs
// a synchronously-available secureContext by the time the handshake reaches
// the point of choosing one, so every hostname the relay might see gets
// pre-warmed before the TLS handshake starts (see connectServer.on('connect')).
const certCache = new Map()

async function secureContextFor(hostname) {
  let ctx = certCache.get(hostname)
  if (ctx) return ctx
  const pems = await generateCert([{ name: 'commonName', value: hostname }], {
    days: 1,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] }]
  })
  ctx = tls.createSecureContext({ key: pems.private, cert: pems.cert })
  certCache.set(hostname, ctx)
  return ctx
}

let connectServer = null
let requestServer = null

export async function startTlsRelay({ upstreamProxy = process.env.HTTPS_PROXY } = {}) {
  if (connectServer) return { port: connectServer.address().port }
  if (!upstreamProxy) throw new Error('startTlsRelay: no upstream HTTPS_PROXY set')

  const agent = new HttpsProxyAgent(upstreamProxy)

  // Decrypted requests land here — we re-issue each one to the real host.
  requestServer = http.createServer((req, res) => {
    const host = req.headers.host
    if (!host) {
      res.writeHead(400)
      res.end('missing Host header')
      return
    }
    const [hostname, portStr] = host.split(':')
    const upstreamReq = https.request(
      {
        hostname,
        port: portStr ? Number(portStr) : 443,
        method: req.method,
        path: req.url,
        headers: req.headers,
        agent
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
        upstreamRes.pipe(res)
      }
    )
    upstreamReq.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502)
      res.end(String(err?.message ?? err))
    })
    req.pipe(upstreamReq)
  })

  // Front door: accepts Chromium's CONNECT, then terminates TLS locally
  // using a cert generated for whatever host it asked for.
  connectServer = http.createServer()
  connectServer.on('connect', async (req, clientSocket, head) => {
    clientSocket.on('error', () => {})
    const [hostname] = req.url.split(':')
    let defaultCtx
    try {
      defaultCtx = await secureContextFor(hostname)
    } catch (err) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
      return
    }
    // The relay can be stopped while a cert was being generated above.
    if (!requestServer) {
      clientSocket.destroy()
      return
    }
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      secureContext: defaultCtx,
      SNICallback: (servername, cb) => {
        secureContextFor(servername || hostname).then(
          (ctx) => cb(null, ctx),
          (err) => cb(err)
        )
      },
      ALPNProtocols: ['http/1.1']
    })
    tlsSocket.on('error', () => clientSocket.destroy())
    if (head && head.length) tlsSocket.unshift(head)
    requestServer.emit('connection', tlsSocket)
  })

  await new Promise((resolve) => connectServer.listen(0, '127.0.0.1', resolve))
  return { port: connectServer.address().port }
}

export async function stopTlsRelay() {
  const servers = [connectServer, requestServer]
  connectServer = null
  requestServer = null
  await Promise.all(servers.filter(Boolean).map((s) => new Promise((r) => s.close(r))))
}
