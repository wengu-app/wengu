// "Evil" servers that record every exfiltration attempt that actually leaves the browser.
import http from 'node:http';
import dgram from 'node:dgram';
import net, { type AddressInfo } from 'node:net';

export interface EvilServers {
  /** Base URL, e.g. http://evil.wengu-test:41234 */
  evil: string;
  /** Base URL of a server that only counts TCP connections (preconnect). */
  pre: string;
  udpPort: number;
  /** Port of a raw TCP listener that counts connections (TURN over TCP). */
  tcpPort: number;
  tcpConnections(): number;
  tcpData(): Buffer[];
  /** Paths requested on the evil server, e.g. '/hit/fetch?d=S3CR3T'. Includes WebSocket upgrades. */
  hits: string[];
  /** Hit names (path segment after /hit/). */
  names(): string[];
  preConnections(): number;
  udpPackets(): Buffer[];
  reset(): void;
  close(): Promise<void>;
}

export async function startEvilServers(): Promise<EvilServers> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' });
    res.end('ok');
  });
  server.on('upgrade', (req, socket) => {
    hits.push(req.url ?? '');
    socket.destroy();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  let preConnections = 0;
  const pre = http.createServer((_req, res) => res.end());
  pre.on('connection', () => preConnections++);
  await new Promise<void>((r) => pre.listen(0, '127.0.0.1', r));

  let tcpConnections = 0;
  const tcpData: Buffer[] = [];
  const tcp = net.createServer((sock) => {
    tcpConnections++;
    sock.on('error', () => {});
    sock.on('data', (d) => tcpData.push(d));
  });
  await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));

  const packets: Buffer[] = [];
  const udp = dgram.createSocket('udp4');
  udp.on('message', (m, rinfo) => {
    packets.push(m);
    // Answer a TURN Allocate (0x0003) with 401 + realm/nonce, like a real TURN server. The browser then retries with
    // the USERNAME attribute set to whatever the page chose: an exfiltration channel.
    if (m.length >= 20 && m.readUInt16BE(0) === 0x0003 && !m.includes(Buffer.from('S3CR3T'))) {
      const attr = (type: number, value: Buffer) => {
        const pad = Buffer.alloc((4 - (value.length % 4)) % 4);
        const h = Buffer.alloc(4);
        h.writeUInt16BE(type, 0);
        h.writeUInt16BE(value.length, 2);
        return Buffer.concat([h, value, pad]);
      };
      const body = Buffer.concat([
        attr(0x0009, Buffer.concat([Buffer.from([0, 0, 4, 1]), Buffer.from('Unauthorized')])),
        attr(0x0014, Buffer.from('evil')),
        attr(0x0015, Buffer.from('nonce123')),
      ]);
      const header = Buffer.alloc(20);
      header.writeUInt16BE(0x0113, 0);
      header.writeUInt16BE(body.length, 2);
      m.copy(header, 4, 4, 20); // magic cookie + transaction id
      udp.send(Buffer.concat([header, body]), rinfo.port, rinfo.address);
    }
  });
  await new Promise<void>((r) => udp.bind(0, '127.0.0.1', r));

  return {
    evil: `http://evil.wengu-test:${(server.address() as AddressInfo).port}`,
    pre: `http://pre.wengu-test:${(pre.address() as AddressInfo).port}`,
    udpPort: udp.address().port,
    tcpPort: (tcp.address() as AddressInfo).port,
    tcpConnections: () => tcpConnections,
    tcpData: () => tcpData,
    hits,
    names: () => [...new Set(hits.map((h) => h.split('?')[0]!.replace(/^\/hit\//, '')))],
    preConnections: () => preConnections,
    udpPackets: () => packets,
    reset() {
      hits.length = 0;
      preConnections = 0;
      tcpConnections = 0;
      tcpData.length = 0;
      packets.length = 0;
    },
    async close() {
      server.closeAllConnections();
      pre.closeAllConnections();
      udp.close();
      tcp.close();
      await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => pre.close(r))]);
    },
  };
}
