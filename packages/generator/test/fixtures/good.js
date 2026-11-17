// A small, correct component used by the tests: an SVG with a two-option review question.
export function mount(root, ctx) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding: var(--wg-space-lg); font-family: var(--wg-font-sans)';
  const h = document.createElement('h3');
  h.textContent = ctx.mode === 'review' ? '哪个角更大？' : '角的大小';
  wrap.append(h);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 400 200');
  svg.style.cssText = 'width:100%;height:240px;display:block';
  svg.innerHTML = '<path d="M20 180 L180 180 L60 40" fill="none" stroke="var(--wg-color-accent)" stroke-width="4"/>' +
    '<path d="M220 180 L380 180 L330 60" fill="none" stroke="var(--wg-color-categorical-1)" stroke-width="4"/>';
  wrap.append(svg);
  if (ctx.mode === 'review') {
    for (const [id, label] of [['a', '左边'], ['b', '右边']]) {
      const b = document.createElement('button');
      b.id = 'opt-' + id;
      b.textContent = label;
      b.addEventListener('click', () => {
        ctx.submitResult({ outcome: id === 'a' ? 'correct' : 'incorrect', detail: label });
        h.textContent = id === 'a' ? '正确' : '不对，左边的角更大';
      }, { signal: ctx.signal });
      wrap.append(b);
    }
  }
  root.append(wrap);
}
