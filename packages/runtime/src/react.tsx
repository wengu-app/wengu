/**
 * Thin React wrapper around ComponentHost. All logic lives in host.ts.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Mode, Phase } from './component-api.ts';
import { ComponentHost, type Delivery, type HostEvent, type HostOptions, type HostStatus, type KillReason } from './host.ts';
import type { JsonObject } from './json.ts';
import type { ComponentPackage } from './manifest.ts';
import type { LibraryBundle } from './protocol.ts';
import type { Theme } from './tokens.ts';

export interface SandboxedComponentProps {
  component: ComponentPackage;
  libraries: Record<string, LibraryBundle>;
  props: JsonObject;
  theme: Theme;
  mode: Mode;
  phase?: Phase;
  delivery?: Delivery;
  watchdog?: HostOptions['watchdog'];
  hostCspCheck?: HostOptions['hostCspCheck'];
  onEvent?: (event: HostEvent) => void;
  /** Rendered over the frame when the component failed or was stopped. Receives a retry callback. */
  fallback?: (info: { status: HostStatus; reason?: KillReason; message?: string; retry: () => void }) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function SandboxedComponent(p: SandboxedComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<ComponentHost | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const applied = useRef<{ theme: Theme; mode: Mode; phase: Phase; props: JsonObject } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [failure, setFailure] = useState<{ status: HostStatus; reason?: KillReason; message?: string } | null>(null);

  const deliveryKey = p.delivery?.kind === 'url' ? p.delivery.url : 'srcdoc';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cur = latest.current;
    const initialPhase = cur.phase ?? 'question';
    setFailure(null);
    const host = new ComponentHost({
      container,
      component: cur.component,
      libraries: cur.libraries,
      props: cur.props,
      theme: cur.theme,
      mode: cur.mode,
      phase: initialPhase,
      ...(cur.delivery ? { delivery: cur.delivery } : {}),
      ...(cur.watchdog !== undefined ? { watchdog: cur.watchdog } : {}),
      ...(cur.hostCspCheck !== undefined ? { hostCspCheck: cur.hostCspCheck } : {}),
      onEvent: (e) => {
        if (e.type === 'killed') setFailure({ status: 'killed', reason: e.reason, message: e.detail });
        else if (e.type === 'error' && (e.phase === 'load' || e.phase === 'mount')) setFailure({ status: 'error', message: e.message });
        else if (e.type === 'ready') setFailure(null);
        latest.current.onEvent?.(e);
      },
    });
    hostRef.current = host;
    applied.current = { theme: cur.theme, mode: cur.mode, phase: initialPhase, props: cur.props };
    return () => {
      host.destroy();
      hostRef.current = null;
    };
  }, [p.component, p.libraries, deliveryKey, generation]);

  useEffect(() => {
    const host = hostRef.current;
    const a = applied.current;
    if (!host || !a) return;
    if (a.theme !== p.theme) {
      a.theme = p.theme;
      host.setTheme(p.theme);
    }
    const nextPhase = p.phase ?? 'question';
    if (a.mode !== p.mode || a.props !== p.props) {
      a.mode = p.mode;
      a.props = p.props;
      a.phase = nextPhase;
      setFailure(null);
      host.remount({ mode: p.mode, props: p.props, phase: nextPhase });
      return;
    }
    if (a.phase !== nextPhase) {
      a.phase = nextPhase;
      host.setPhase(nextPhase);
    }
  }, [p.theme, p.mode, p.phase, p.props]);

  const retry = () => setGeneration((g) => g + 1);

  return (
    <div className={p.className} style={{ position: 'relative', ...p.style }}>
      <div ref={containerRef} />
      {failure && p.fallback?.({ ...failure, retry })}
    </div>
  );
}
