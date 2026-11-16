// Test component: animates, then blocks its main thread.
// props.delayMs: wait before blocking. props.blockMs: how long to block; -1 = forever (while (true)).
export function mount(root, ctx) {
  const box = document.createElement('div');
  box.style.cssText = 'height:200px;display:grid;place-items:center;font:600 20px system-ui';
  root.append(box);
  let frames = 0;
  let raf = requestAnimationFrame(function tick() {
    box.textContent = `frame ${++frames}`;
    raf = requestAnimationFrame(tick);
  });
  const timer = setTimeout(() => {
    box.dataset.blocking = '1';
    const ms = ctx.props.blockMs ?? 5000;
    if (ms < 0) {
      // eslint-disable-next-line no-constant-condition
      while (true) {}
    }
    const end = performance.now() + ms;
    while (performance.now() < end) {}
    box.dataset.blocking = 'done';
  }, ctx.props.delayMs ?? 500);
  return () => {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
  };
}
