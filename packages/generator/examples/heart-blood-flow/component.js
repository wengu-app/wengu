let instance = 0;
export function mount(root, ctx) {
  const uid = 'flow-' + (++instance);
  const review = ctx.mode === 'review';
  let answered = false;
  let step = 2;
  const stages = [
    ['全身', '血液流经全身组织后，含氧量降低，再经上、下腔静脉回到心脏。', 'body'],
    ['上、下腔静脉', '把体循环回来的静脉血送入右心房。', 'vena'],
    ['右心房', '接收上、下腔静脉的血液，再经三尖瓣进入右心室。', 'ra'],
    ['右心室', '将含氧少的血液经肺动脉瓣泵入肺动脉，送往肺部。', 'rv'],
    ['肺动脉', '离开心脏、通向肺部；这里流的是含氧少的静脉血。', 'pa'],
    ['肺部', '完成气体交换：血液获得氧，变为含氧丰富的动脉血。', 'lung'],
    ['肺静脉', '从肺部返回心脏；这里流的是含氧丰富的动脉血，进入左心房。', 'pv'],
    ['左心房', '接收肺静脉的血液，再经二尖瓣进入左心室。', 'la'],
    ['左心室', '室壁最厚：要经主动脉瓣把血液泵入主动脉，送往全身。', 'lv'],
    ['主动脉', '把含氧丰富的动脉血送往全身，随后血液再次回到右心。', 'aorta']
  ];
  root.innerHTML = `<style>
    .heart-flow{--poor:var(--wg-color-categorical-0);--rich:var(--wg-color-categorical-4);font-family:var(--wg-font-sans);color:var(--wg-color-text);max-width:680px;margin:auto;padding:16px;box-sizing:border-box;font-size:15px;line-height:1.55}
    .heart-flow *{box-sizing:border-box}.heart-flow h2{font-size:20px;margin:0 0 6px}.heart-flow p{margin:0}.heart-flow .intro{color:var(--wg-color-text-muted);min-height:46px}.heart-flow.masked{--poor:var(--wg-color-text-muted);--rich:var(--wg-color-text-muted)}
    .heart-flow .legend{display:flex;gap:20px;flex-wrap:wrap;margin-top:10px;font-size:13px;min-height:22px}.heart-flow .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}.heart-flow .muted{color:var(--wg-color-text-muted)}
    .heart-flow svg{display:block;width:100%;height:440px;overflow:visible}.heart-flow svg text{fill:var(--wg-color-text);font-family:var(--wg-font-sans);font-size:14px;text-anchor:middle}.heart-flow .region{fill:var(--wg-color-background);stroke:var(--wg-color-border);stroke-width:1.5}.heart-flow .node{fill:var(--wg-color-surface);stroke:var(--wg-color-border);stroke-width:2}.heart-flow .poor{stroke:var(--poor)}.heart-flow .rich{stroke:var(--rich)}.heart-flow .route{fill:none;stroke-width:3.5;stroke-linejoin:round;stroke-linecap:round}.heart-flow .trace{stroke-width:6}.heart-flow .selected .node{stroke:var(--wg-color-accent);stroke-width:3}.heart-flow .wall{fill:none;stroke:var(--wg-color-text-muted);stroke-width:6}.heart-flow .valve{fill:none;stroke:var(--wg-color-text);stroke-width:2.2;stroke-linecap:round}.heart-flow .target{fill:none;stroke:var(--wg-color-accent);stroke-width:2;stroke-dasharray:5 4}.heart-flow .hit{fill:none;stroke:transparent;stroke-width:24;cursor:pointer}.heart-flow .interactive{cursor:pointer}.heart-flow .interactive:focus{outline:none}.heart-flow .interactive:focus .node{stroke:var(--wg-color-accent);stroke-width:3}.heart-flow svg .small{font-size:14px;fill:var(--wg-color-text-muted)}
    .heart-flow .caption{padding:14px;background:var(--wg-color-background);border-radius:10px;min-height:113px;border:1px solid var(--wg-color-border)}.heart-flow .caption strong{display:block;margin-bottom:4px}.heart-flow .controls{display:flex;align-items:center;gap:12px;justify-content:space-between;margin-top:12px}.heart-flow button{font:inherit;background:var(--wg-color-surface);color:var(--wg-color-text);border:1px solid var(--wg-color-border);border-radius:8px;padding:9px 12px;cursor:pointer;min-height:42px}.heart-flow button:hover:not(:disabled){border-color:var(--wg-color-accent)}.heart-flow button:focus-visible{outline:2px solid var(--wg-color-accent);outline-offset:2px}.heart-flow button:disabled{cursor:default}.heart-flow .choices{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0 12px}.heart-flow .choices button{text-align:left;font-size:14px}.heart-flow .choices b,.heart-flow .choices span{display:block}.heart-flow .choices .right{border:2px solid var(--wg-color-success)}.heart-flow .choices .wrong{border:2px solid var(--wg-color-danger)}.heart-flow .foot{font-size:13px;color:var(--wg-color-text-muted);margin-top:12px}.heart-flow [hidden]{display:none!important}
  </style>
  <section class="heart-flow ${review ? 'masked' : ''}">
    <h2>${review ? '这条血管里流着什么血？' : '跟着血液走一圈'}</h2>
    <p class="intro">${review ? '虚线框标出右心室通向肺部的血管。请选择它的名称与血液类型。' : '沿箭头追踪：全身 → 右心 → 肺 → 左心 → 全身。点击心腔或血管，查看这一站。'}</p>
    <div class="legend">${review ? '<span class="muted">血液颜色暂时隐藏，请根据路径判断。</span>' : ''}<span class="oxygen" ${review ? 'hidden' : ''}><i class="dot" style="background:var(--poor)"></i>含氧少 · 静脉血</span><span class="oxygen" ${review ? 'hidden' : ''}><i class="dot" style="background:var(--rich)"></i>含氧丰富 · 动脉血</span></div>
    <svg viewBox="0 0 360 440" height="440" role="img" aria-label="血液循环流程示意，非解剖位置：全身经右心到肺，再经左心回全身">
      <defs><marker id="${uid}-p" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L10 5 L0 10Z" fill="var(--poor)"/></marker><marker id="${uid}-r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L10 5 L0 10Z" fill="var(--rich)"/></marker></defs>
      <rect class="region" x="83" y="46" width="194" height="132" rx="16"/>
      <text x="180" y="69">右心</text>
      <rect class="region" x="83" y="284" width="194" height="124" rx="16"/>
      <text x="180" y="305">左心</text>
      <path data-route="vena" class="route poor" d="M44 195 V115 H100" marker-end="url(#${uid}-p)"/>
      <path class="route poor" d="M165 115 H190" marker-end="url(#${uid}-p)"/>
      <path data-route="pa" class="route poor" d="M255 115 H316 V195" marker-end="url(#${uid}-p)"/>
      <path data-route="pv" class="route rich" d="M316 265 V345 H255" marker-end="url(#${uid}-r)"/>
      <path class="route rich" d="M190 345 H165" marker-end="url(#${uid}-r)"/>
      <path data-route="aorta" class="route rich" d="M100 345 H44 V265" marker-end="url(#${uid}-r)"/>
      <g data-part="body"><rect class="node" x="8" y="195" width="72" height="70" rx="14"/><text x="44" y="224" style="font-size:17px">全身</text><text x="44" y="248" class="small">组织</text></g>
      <g data-part="lung"><rect class="node" x="280" y="195" width="72" height="70" rx="14"/><text x="316" y="224" style="font-size:17px">肺部</text><text x="316" y="248" class="small">气体交换</text></g>
      <g data-part="ra"><rect class="node" x="100" y="85" width="65" height="60" rx="10"/><text x="132.5" y="120">右心房</text></g>
      <g data-part="rv"><rect class="node" x="190" y="85" width="65" height="60" rx="10"/><text x="222.5" y="120">右心室</text></g>
      <g data-part="la"><rect class="node" x="190" y="315" width="65" height="60" rx="10"/><text x="222.5" y="350">左心房</text></g>
      <g data-part="lv"><rect class="node" x="100" y="315" width="65" height="60" rx="10"/><rect class="wall" x="104" y="319" width="57" height="52" rx="8"/><text x="132.5" y="350">左心室</text></g>
      <text x="44" y="75">上、下</text><text x="44" y="94">腔静脉</text>
      <text data-label="pa" x="316" y="94">${review ? '？' : '肺动脉'}</text>
      <text data-label="pv" x="316" y="369">${review ? '' : '肺静脉'}</text>
      <text x="44" y="369">主动脉</text>
      <path d="M95 230 H117 M243 230 H265" stroke="var(--wg-color-border)" stroke-width="2"/>
      <text x="180" y="222" class="small">左右两侧</text><text x="180" y="244" class="small">不直接相通</text>
      <path class="valve" d="M172 106 L178 113 M172 124 L178 117 M263 106 L269 113 M263 124 L269 117 M183 336 L177 343 M183 354 L177 347 M94 336 L88 343 M94 354 L88 347"/>
      <text x="180" y="167" class="small" data-extra>${review ? '' : '三尖瓣 → 肺动脉瓣'}</text>
      <text x="180" y="397" class="small" data-extra>${review ? '' : '主动脉瓣 ← 二尖瓣'}</text>
      <rect class="target" x="288" y="125" width="56" height="60" rx="10" ${review ? '' : 'hidden'}/>
      <path data-part="vena" class="hit" d="M44 195 V115 H100"/>
      <path data-part="pa" class="hit" d="M255 115 H316 V195"/>
      <path data-part="pv" class="hit" d="M316 265 V345 H255"/>
      <path data-part="aorta" class="hit" d="M100 345 H44 V265"/>
      <text x="180" y="432" class="small">流程示意，非解剖位置；未按比例绘制</text>
    </svg>
    ${review ? `<div class="choices" aria-label="选择答案"><button type="button" id="answer-pa-venous"><b>肺动脉</b><span>含氧少的静脉血</span></button><button type="button" id="answer-pa-arterial"><b>肺动脉</b><span>含氧丰富的动脉血</span></button><button type="button" id="answer-pv-arterial"><b>肺静脉</b><span>含氧丰富的动脉血</span></button><button type="button" id="answer-pv-venous"><b>肺静脉</b><span>含氧少的静脉血</span></button></div>` : ''}
    <div class="caption" aria-live="polite"><strong class="station"></strong><p class="explanation"></p></div>
    <div class="controls" ${review ? 'hidden' : ''}><button type="button" id="previous-stop">← 上一站</button><span class="counter muted"></span><button type="button" id="next-stop">下一站 →</button></div>
    <p class="foot">${review ? '动脉、静脉的命名依据是血流相对心脏的方向。' : '瓣膜使血液单向通过：心房 → 心室 → 动脉。左心室的粗边框表示更厚的室壁。'}</p>
  </section>`;
  const box = root.querySelector('.heart-flow');
  const station = root.querySelector('.station');
  const explanation = root.querySelector('.explanation');
  function showStep() {
    const current = stages[step];
    station.textContent = current[0];
    explanation.textContent = current[1];
    root.querySelector('.counter').textContent = (step + 1) + ' / ' + stages.length;
    root.querySelectorAll('[data-part]').forEach(el => el.classList.toggle('selected', el.dataset.part === current[2]));
    root.querySelectorAll('[data-route]').forEach(el => el.classList.toggle('trace', el.dataset.route === current[2]));
  }
  if (!review) {
    showStep();
    root.querySelector('#previous-stop').addEventListener('click', () => { step = (step + stages.length - 1) % stages.length; showStep(); }, {signal:ctx.signal});
    root.querySelector('#next-stop').addEventListener('click', () => { step = (step + 1) % stages.length; showStep(); }, {signal:ctx.signal});
    root.querySelectorAll('[data-part]').forEach(el => {
      const index = stages.findIndex(s => s[2] === el.dataset.part);
      el.classList.add('interactive');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', '查看' + stages[index][0]);
      const choose = () => {step = index; showStep();};
      el.addEventListener('click', choose, {signal:ctx.signal});
      el.addEventListener('keydown', e => {if(e.key === 'Enter' || e.key === ' ') {e.preventDefault(); choose();}}, {signal:ctx.signal});
    });
  } else {
    station.textContent = '判断标出的血管';
    explanation.textContent = '从右心室出发，沿箭头走向肺部。选出名称与血液类型都正确的一项。';
    const answers = [
      ['answer-pa-venous', '肺动脉，含氧少的静脉血'],
      ['answer-pa-arterial', '肺动脉，含氧丰富的动脉血'],
      ['answer-pv-arterial', '肺静脉，含氧丰富的动脉血'],
      ['answer-pv-venous', '肺静脉，含氧少的静脉血']
    ];
    answers.forEach(([id, label], index) => {
      root.querySelector('#' + id).addEventListener('click', () => {
        if(answered) return;
        answered = true;
        const correct = index === 0;
        box.classList.remove('masked');
        root.querySelector('.legend .muted').hidden = true;
        root.querySelectorAll('.oxygen').forEach(el => el.hidden = false);
        root.querySelector('[data-label="pa"]').textContent = '肺动脉';
        root.querySelector('[data-label="pv"]').textContent = '肺静脉';
        root.querySelectorAll('[data-extra]').forEach((el,i) => el.textContent = i ? '主动脉瓣 ← 二尖瓣' : '三尖瓣 → 肺动脉瓣');
        root.querySelector('[data-route="pa"]').classList.add('trace');
        root.querySelectorAll('.choices button').forEach(el => el.disabled = true);
        root.querySelector('#answer-pa-venous').classList.add('right');
        if(!correct) root.querySelector('#' + id).classList.add('wrong');
        station.textContent = correct ? '正确：肺动脉里流的是静脉血' : '再记一次：肺动脉里流的是静脉血';
        station.style.color = correct ? 'var(--wg-color-success)' : 'var(--wg-color-danger)';
        explanation.textContent = '血液从右心室经肺动脉送往肺部，此时含氧少；在肺部获得氧后，才经肺静脉回到左心房。';
        ctx.submitResult({outcome:correct ? 'correct' : 'incorrect', score:correct ? 1 : 0, detail:'选择：' + label, response:{choice:id}});
      }, {signal:ctx.signal});
    });
  }
  return () => {};
}
