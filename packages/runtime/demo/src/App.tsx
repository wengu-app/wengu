import { useCallback, useEffect, useMemo, useState } from 'react';
import { themeFor, tokensToCssVariables, type ColorScheme, type HostEvent, type Mode, type ReviewResult } from '../../src/index.ts';
import { SandboxedComponent } from '../../src/react.tsx';
import { ethanolProps, libraries, moleculeViewer } from './catalog.ts';

type DeliveryChoice = 'srcdoc' | 'url';
const SANDBOX_URL = 'http://127.0.0.1:5174/sandbox.html';

interface LogEntry {
  id: number;
  t: number;
  text: string;
  tone?: 'ok' | 'bad' | 'warn';
}

let logId = 0;

function initialScheme(): ColorScheme {
  const q = new URLSearchParams(location.search).get('theme');
  if (q === 'light' || q === 'dark') return q;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialMode(): Mode {
  return new URLSearchParams(location.search).get('mode') === 'review' ? 'review' : 'learn';
}

function initialDelivery(): DeliveryChoice {
  return new URLSearchParams(location.search).get('delivery') === 'url' ? 'url' : 'srcdoc';
}

export function App() {
  const [scheme, setScheme] = useState<ColorScheme>(initialScheme);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [delivery, setDelivery] = useState<DeliveryChoice>(initialDelivery);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [status, setStatus] = useState('loading');
  const [rtt, setRtt] = useState<number | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [attempt, setAttempt] = useState(0);
  const theme = useMemo(() => themeFor(scheme), [scheme]);

  // The host app uses the same tokens as the components.
  useEffect(() => {
    const de = document.documentElement;
    for (const [k, v] of Object.entries(tokensToCssVariables(theme.tokens))) de.style.setProperty(k, v);
    de.style.colorScheme = scheme;
    de.dataset.theme = scheme;
  }, [theme, scheme]);

  const push = useCallback((text: string, tone?: LogEntry['tone']) => {
    setLog((l) => [{ id: ++logId, t: performance.now(), text, ...(tone ? { tone } : {}) }, ...l].slice(0, 60));
  }, []);

  const onEvent = useCallback(
    (e: HostEvent) => {
      switch (e.type) {
        case 'status':
          setStatus(e.status);
          break;
        case 'heartbeat':
          setRtt(e.rttMs);
          break;
        case 'ready':
          push(`ready · 挂载 ${e.mountMs.toFixed(0)} ms，总计 ${e.totalMs.toFixed(0)} ms`, 'ok');
          break;
        case 'resize':
          push(`resize · 高度 ${e.height}px`);
          break;
        case 'result':
          setResult(e.result);
          push(`result · ${e.result.outcome}${e.result.detail ? ' · ' + e.result.detail : ''}`, e.result.outcome === 'correct' ? 'ok' : 'bad');
          break;
        case 'error':
          push(`error[${e.phase}] · ${e.message}`, 'bad');
          break;
        case 'violation':
          push(`已丢弃 · ${e.reason}`, 'warn');
          break;
        case 'killed':
          push(`已停止组件 · ${e.reason} · ${e.detail}`, 'bad');
          break;
        case 'unprotected':
          push(`宿主页面未阻止 frame 导航 · ${e.detail}`, 'bad');
          break;
      }
    },
    [push],
  );

  // New props object per attempt -> the host remounts the component in place.
  const props = useMemo(() => ({ ...ethanolProps, attempt }), [attempt]);

  const changeMode = (m: Mode) => {
    setMode(m);
    setResult(null);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="seal">温</span>
          <span className="wordmark">温故</span>
          <span className="tag">组件沙箱 · M0 原型</span>
        </div>
        <div className="controls">
          <Segmented
            label="模式"
            value={mode}
            options={[
              ['learn', '学习'],
              ['review', '复习'],
            ]}
            onChange={changeMode}
          />
          <Segmented
            label="主题"
            value={scheme}
            options={[
              ['light', '浅色'],
              ['dark', '深色'],
            ]}
            onChange={setScheme}
          />
          <Segmented
            label="沙箱"
            value={delivery}
            options={[
              ['srcdoc', 'srcdoc'],
              ['url', '独立源'],
            ]}
            onChange={(d) => {
              setDelivery(d);
              setResult(null);
              push(d === 'url' ? `切换到独立源：${SANDBOX_URL}` : '切换到 srcdoc');
            }}
          />
        </div>
      </header>

      <main className="layout">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="crumb">有机化学 · 醇类</div>
              <h1>乙醇的分子结构</h1>
            </div>
            <StatusPill status={status} rtt={rtt} />
          </div>

          <SandboxedComponent
            className="frame"
            component={moleculeViewer}
            libraries={libraries}
            props={props}
            theme={theme}
            mode={mode}
            delivery={delivery === 'url' ? { kind: 'url', url: SANDBOX_URL } : { kind: 'srcdoc' }}
            // The page is served with hostPageCsp() (vite.config.ts); refuse to run components if that is ever lost.
            hostCspCheck="enforce"
            onEvent={onEvent}
            fallback={({ status: s, reason, message, retry }) => (
              <div className="fallback">
                <div className="fallback-title">{s === 'killed' ? '组件已停止' : '组件加载失败'}</div>
                <div className="fallback-detail">{reason ? `${reason} · ` : ''}{message}</div>
                <button onClick={retry}>重新加载</button>
              </div>
            )}
          />

          {mode === 'review' && (
            <div className={`result ${result ? result.outcome : 'pending'}`} data-testid="result">
              {result ? (
                <>
                  <span className="result-mark">{result.outcome === 'correct' ? '✓' : '✕'}</span>
                  <div className="result-body">
                    <div className="result-title">
                      {result.outcome === 'correct' ? '回答正确' : '回答错误'}
                      <span className="rating">记入排期：{result.outcome === 'correct' ? '良好 Good' : '重来 Again'}</span>
                    </div>
                    {result.detail && <div className="result-detail">{result.detail}</div>}
                  </div>
                  <button
                    className="ghost"
                    onClick={() => {
                      setResult(null);
                      setAttempt((a) => a + 1);
                    }}
                  >
                    再试一次
                  </button>
                </>
              ) : (
                <span className="result-wait">等待作答 · 结果由组件通过 result 消息上报</span>
              )}
            </div>
          )}
        </section>

        <aside className="side">
          <div className="panel">
            <div className="panel-title">组件</div>
            <dl className="meta">
              <dt>ID</dt>
              <dd><code>{moleculeViewer.manifest.id}</code></dd>
              <dt>API</dt>
              <dd>v{moleculeViewer.manifest.apiVersion}</dd>
              <dt>库</dt>
              <dd>{moleculeViewer.manifest.libraries.map((l) => `${l} ${libraries[l]?.version ?? ''}`).join(', ')}</dd>
              <dt>知识点</dt>
              <dd><code>{moleculeViewer.manifest.knowledgePoints.join(', ')}</code></dd>
              <dt>来源</dt>
              <dd>
                {moleculeViewer.manifest.sources.map((s) => (
                  <div key={s.title}>{s.title}</div>
                ))}
              </dd>
              <dt>隔离</dt>
              <dd>sandbox="allow-scripts" · 无网络 · 无存储</dd>
            </dl>
          </div>
          <div className="panel">
            <div className="panel-title">消息</div>
            <ol className="log" data-testid="log">
              {log.length === 0 && <li className="muted">—</li>}
              {log.map((e) => (
                <li key={e.id} className={e.tone ?? ''}>
                  <span className="ts">{(e.t / 1000).toFixed(2)}s</span>
                  {e.text}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </main>
    </div>
  );
}

function Segmented<T extends string>(p: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={p.label}>
      {p.options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={p.value === v} className={p.value === v ? 'on' : ''} onClick={() => p.onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status, rtt }: { status: string; rtt: number | null }) {
  const label: Record<string, string> = { loading: '加载中', ready: '运行中', error: '出错', killed: '已停止', destroyed: '已卸载' };
  return (
    <div className={`pill ${status}`} data-testid="status">
      <i />
      {label[status] ?? status}
      {status === 'ready' && rtt !== null && <span className="rtt">心跳 {rtt.toFixed(1)} ms</span>}
    </div>
  );
}
