export function mount(root, ctx) {
  const review = ctx.mode === 'review';
  let scenario = 'balanced', key = 35, step = 0, answered = false, chosen = null;
  const balanced = [
    {v:50,x:300,y:38,l:30,r:70},
    {v:30,x:150,y:108,l:20,r:40},
    {v:70,x:450,y:108,l:60,r:80},
    {v:20,x:75,y:178}, {v:40,x:225,y:178},
    {v:60,x:375,y:178}, {v:80,x:525,y:178}
  ];
  const chain = [1,2,3,4,5].map((v,i)=>({v,x:90+i*85,y:32+i*46,r:v<5?v+1:undefined}));
  root.innerHTML = `<style>
    .bst{font-family:var(--wg-font-sans);color:var(--wg-color-text);padding:16px;max-width:860px;margin:auto;box-sizing:border-box;font-size:15px;line-height:1.55}
    .bst *{box-sizing:border-box}.bst h2{font-size:21px;margin:0 0 6px}.bst p{margin:6px 0 12px}.bst .muted{color:var(--wg-color-text-muted);font-size:13px}
    .bst .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.bst button{font:inherit;color:var(--wg-color-text);background:var(--wg-color-surface);border:1px solid var(--wg-color-text-muted);border-radius:8px;padding:7px 12px;cursor:pointer;min-height:38px}
    .bst button[aria-pressed=true],.bst .primary{background:var(--wg-color-accent);border-color:var(--wg-color-accent);color:var(--wg-color-on-accent)}
    .bst button:disabled{opacity:.5;cursor:default}.bst button:focus-visible,.bst [role=button]:focus-visible{outline:3px solid var(--wg-color-accent);outline-offset:3px}
    .bst .stage{background:var(--wg-color-background);border-radius:12px;overflow:hidden}.bst .stagehead{padding:12px 14px 0;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.bst .badge{font-weight:700;color:var(--wg-color-accent)}
    .bst svg{display:block;width:100%;height:330px;user-select:none}.bst svg text{font-family:var(--wg-font-mono);font-size:24px;fill:var(--wg-color-text);text-anchor:middle;dominant-baseline:central;pointer-events:none}
    .bst .edge{stroke:var(--wg-color-text-muted);stroke-width:2.5}.bst .edge.active{stroke:var(--wg-color-accent);stroke-width:5}
    .bst .node{fill:var(--wg-color-surface);stroke:var(--wg-color-text-muted);stroke-width:2.5}.bst .node.active{stroke:var(--wg-color-accent);stroke-width:4}.bst .node.current{fill:var(--wg-color-accent)}.bst text.current{fill:var(--wg-color-on-accent)}
    .bst .slot{fill:var(--wg-color-surface);stroke:var(--wg-color-text-muted);stroke-width:2;stroke-dasharray:5 4}.bst .slot-group[role=button]{cursor:pointer}.bst .slot-group[role=button]:hover .slot{stroke:var(--wg-color-accent);stroke-width:4}.bst .wrong{stroke:var(--wg-color-danger);stroke-width:4}.bst .new{fill:var(--wg-color-accent);stroke:var(--wg-color-accent);stroke-width:3}
    .bst .panel{padding:12px 14px;min-height:90px;border-top:1px solid var(--wg-color-border)}.bst .equation{font-size:18px;font-weight:650}.bst .note{padding:12px 0 0;border-top:1px solid var(--wg-color-border);margin-top:12px}.bst .feedback{min-height:78px;padding-top:12px}.bst .success{color:var(--wg-color-success)}.bst .danger{color:var(--wg-color-danger)}
    @media(max-width:440px){.bst{padding:10px}.bst svg{height:300px}.bst button{padding:7px 10px}}
  </style><section class="bst"></section>`;
  const host = root.querySelector('.bst');
  function model() {
    const nodes = scenario === 'balanced' ? balanced : chain;
    const map = new Map(nodes.map(n=>[n.v,n]));
    const path = []; let n = nodes[0], side;
    while(n) { path.push(n); side = key < n.v ? 'L' : 'R'; const next = side === 'L' ? n.l : n.r; if(next === undefined) break; n = map.get(next); }
    const slots = [];
    if(scenario === 'balanced') {
      nodes.filter(n=>n.l === undefined && n.r === undefined).forEach(n=>{
        slots.push({id:n.v+'-L',p:n,side:'L',x:n.x-35,y:262});
        slots.push({id:n.v+'-R',p:n,side:'R',x:n.x+35,y:262});
      });
    } else {
      const p=nodes[nodes.length-1]; slots.push({id:'5-R',p,side:'R',x:515,y:276});
    }
    return {nodes,map,path,slots,target:n.v+'-'+side};
  }
  function render() {
    const m=model();
    const done=review ? answered : step===m.path.length;
    const visiblePath=review && !answered ? [] : m.path.slice(0,done?m.path.length:step+1);
    const active=new Set(visiblePath.map(n=>n.v));
    const target=m.slots.find(s=>s.id===m.target);
    const current=!done && !review ? m.path[step] : null;
    let edges='';
    m.nodes.forEach(n=>[n.l,n.r].forEach(v=>{if(v!==undefined){const c=m.map.get(v);edges+=`<line class="edge ${active.has(n.v)&&active.has(v)?'active':''}" x1="${n.x}" y1="${n.y}" x2="${c.x}" y2="${c.y}"/>`;}}));
    m.slots.forEach(s=>{edges+=`<line class="edge ${done&&s.id===m.target?'active':''}" x1="${s.p.x}" y1="${s.p.y}" x2="${s.x}" y2="${s.y}"/>`;});
    const nodeSvg=m.nodes.map(n=>`<g><circle class="node ${active.has(n.v)?'active':''} ${current===n?'current':''}" cx="${n.x}" cy="${n.y}" r="24"/><text class="${current===n?'current':''}" x="${n.x}" y="${n.y}">${n.v}</text></g>`).join('');
    const slotSvg=m.slots.map(s=>{
      const isNew=done&&s.id===m.target;
      const selectable=review&&!answered;
      return `<g class="slot-group" ${selectable?`role="button" tabindex="0" aria-label="${s.p.v} 的${s.side==='L'?'左':'右'}孩子空位" data-slot="${s.id}"`:''}><circle class="${isNew?'new':'slot'} ${done&&chosen===s.id&&s.id!==m.target?'wrong':''}" cx="${s.x}" cy="${s.y}" r="22"/><text class="${isNew?'current':''}" x="${s.x}" y="${s.y}">${isNew?key:'+'}</text></g>`;
    }).join('');
    let panel;
    if(review&&!answered) panel='<div class="equation">选择一个「＋」空位</div><div class="muted">左子树的键更小，右子树的键更大。</div>';
    else if(done) panel=`<div class="equation">${m.path.map(n=>n.v).join(' → ')} → 插入 ${key}</div><div>比较 ${m.path.length} 次 · 新结点深度 ${m.path.length}（根的深度为 0）</div>`;
    else panel=`<div class="equation">${key} ${key<current.v?'＜':'＞'} ${current.v} → 走向${key<current.v?'左':'右'}孩子</div><div>第 ${step+1} 次比较${step===m.path.length-1?' · 下一步遇到空位':''}</div>`;
    host.innerHTML=`<h2>${review?'把 35 插入 BST':'沿比较路径插入'}</h2><p>${review?'点击 35 应占据的空位置。':'从根开始比较，直到空位；新键成为叶子。'}</p>
      ${review?'':`<div class="row" aria-label="树的形状"><button data-scenario="balanced" aria-pressed="${scenario==='balanced'}">平衡示例</button><button data-scenario="chain" aria-pressed="${scenario==='chain'}">有序插入 → 链</button></div><div class="row"><span>待插入键</span>${(scenario==='balanced'?[25,35,65]:[6]).map(v=>`<button data-key="${v}" aria-pressed="${key===v}">${v}</button>`).join('')}</div>`}
      <div class="stage"><div class="stagehead"><span class="badge">待插入：${key}</span><span class="muted">${review?'已有 7 个结点':scenario==='balanced'?'已有：50, 30, 70, 20, 40, 60, 80':'已有：按顺序插入 1, 2, 3, 4, 5'}</span></div><svg viewBox="0 0 600 310" height="330" aria-label="二叉搜索树；加号表示空位置">${edges}${nodeSvg}${slotSvg}</svg><div class="panel" aria-live="polite">${panel}</div></div>
      ${review?`<div class="feedback" role="status">${answered?`<strong class="${chosen===m.target?'success':'danger'}">${chosen===m.target?'正确':'还不正确'}。</strong>35 应成为 40 的左孩子：依次与 50、30、40 比较，走左、右、左；已有结点不移动。`:'虚线圆是空位置；已有结点不能移动。'}</div>`:`<div class="row"><button class="primary" data-action="next" ${done?'disabled':''}>${done?'插入完成':step===m.path.length-1?'到空位，插入':'沿分支继续'}</button><button data-action="reset">重新走一遍</button><span class="muted">${done?'已有结点的位置不变':'实心蓝圆：当前比较的结点'}</span></div><div class="note">${scenario==='balanced'?'比较次数 = 新结点的深度。随机插入时，平均为 O(log n)；切换到有序插入，看看最坏情况。':'有序插入让树退化成链：插入 6 要比较全部 5 个已有结点，最坏为 O(n)。'}</div>`}`;
  }
  function answer(id) {
    if(!review||answered) return;
    const m=model(); const slot=m.slots.find(s=>s.id===id); if(!slot)return;
    chosen=id; answered=true;
    render();
    ctx.submitResult({outcome:id===m.target?'correct':'incorrect',score:id===m.target?1:0,detail:`将 35 放在 ${slot.p.v} 的${slot.side==='L'?'左':'右'}孩子空位。`,response:{key:35,parent:slot.p.v,side:slot.side}});
  }
  root.addEventListener('click', e=>{
    const el=e.target.closest('[data-slot],[data-scenario],[data-key],[data-action]'); if(!el)return;
    if(el.dataset.slot){answer(el.dataset.slot);return;}
    if(review)return;
    if(el.dataset.scenario){scenario=el.dataset.scenario;key=scenario==='balanced'?35:6;step=0;}
    else if(el.dataset.key){key=Number(el.dataset.key);step=0;}
    else if(el.dataset.action==='reset')step=0;
    else if(el.dataset.action==='next')step=Math.min(step+1,model().path.length);
    render();
  },{signal:ctx.signal});
  root.addEventListener('keydown',e=>{
    const el=e.target.closest('[data-slot]');
    if(el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();answer(el.dataset.slot);}
  },{signal:ctx.signal});
  render();
  return ()=>{root.innerHTML='';};
}