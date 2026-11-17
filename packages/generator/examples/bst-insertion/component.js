export function mount(root, ctx) {
  const review = ctx.mode === 'review';
  let scenario = 'balanced', key = 35, step = 0, answered = false, chosen = '', correctAnswer = false;
  let width = 600;
  const signal = ctx.signal;
  root.innerHTML = `<style>
    .bst{font-family:var(--wg-font-sans);color:var(--wg-color-text);padding:16px;box-sizing:border-box;max-width:900px;margin:auto;font-size:15px;line-height:1.55}
    .bst *{box-sizing:border-box}.bst h2{font-size:20px;margin:0 0 6px}.bst p{margin:0}.bst .muted{color:var(--wg-color-text-muted);font-size:13px}.bst .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.bst .controls{margin:16px 0 10px}.bst button{font:inherit;border:1px solid var(--wg-color-border);background:var(--wg-color-surface);color:var(--wg-color-text);border-radius:8px;padding:7px 12px;cursor:pointer;min-height:38px}.bst button.active,.bst button.primary{background:var(--wg-color-accent);color:var(--wg-color-on-accent);border-color:var(--wg-color-accent)}.bst button:disabled{opacity:.45;cursor:default}.bst button:focus-visible,.bst [role=button]:focus-visible{outline:3px solid var(--wg-color-accent);outline-offset:3px}.bst .keybar{margin-top:12px}.bst .badge{font-family:var(--wg-font-mono);border:1px solid var(--wg-color-accent);color:var(--wg-color-accent);padding:4px 12px;border-radius:7px;font-weight:600}.bst .diagram{margin-top:12px;border:1px solid var(--wg-color-border);border-radius:12px;background:var(--wg-color-background);overflow:hidden}.bst .legend{padding:10px 12px 0;font-size:12px;color:var(--wg-color-text-muted)}.bst svg{display:block;width:100%;height:340px}.bst svg text{font-family:var(--wg-font-sans);font-size:14px;pointer-events:none}.bst .status{border-left:3px solid var(--wg-color-accent);padding:10px 12px;background:var(--wg-color-background);margin:12px 0;min-height:85px;border-radius:0 8px 8px 0}.bst .status strong{display:block;margin-bottom:4px}.bst .stats{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:13px}.bst .foot{font-size:13px;color:var(--wg-color-text-muted);margin-top:14px}.bst [data-slot]{cursor:pointer}.bst [data-slot]:hover circle{stroke-width:3}.bst .sequence{margin-top:7px;min-height:21px;overflow-wrap:anywhere}
  </style>
  <section class="bst">
    <h2>${review ? '把 35 插入这棵树' : '沿比较路径，找到空位置'}</h2>
    <p class="muted">${review ? '从根结点开始判断，点击新结点应占据的空心圈。' : '左子树的键都更小，右子树的键都更大。'}</p>
    ${review ? '' : `<div class="row controls"><button id="balanced" class="active">平衡树</button><button id="chain">有序插入形成的链</button></div><div class="row" id="keys"><span class="muted">尝试插入</span><button data-key="35" class="active">35</button><button data-key="65">65</button><button data-key="10">10</button><button data-key="90">90</button></div>`}
    <div class="row keybar"><span class="badge" id="target"></span><span class="muted">原有结点不移动</span></div>
    <p class="muted sequence" id="sequence"></p>
    <div class="diagram"><div class="legend">左：更小　右：更大　｜　空心圈：空位置</div><svg id="tree" height="340" role="group" aria-label="二叉搜索树插入示意图"></svg></div>
    <div class="status" id="status" aria-live="polite"></div>
    ${review ? '' : `<div class="row"><button class="primary" id="next">下一次比较</button><button id="reset">重新演示</button></div><p class="foot">根的深度为 0；比较次数等于新叶子的深度。随机插入时平均为 O(log n)，有序插入可能退化为 O(n)。</p>`}
  </section>`;
  const q = s => root.querySelector(s);
  const svg = q('#tree');
  const C = {text:'var(--wg-color-text)',muted:'var(--wg-color-text-muted)',border:'var(--wg-color-border)',accent:'var(--wg-color-accent)',surface:'var(--wg-color-surface)',background:'var(--wg-color-background)',danger:'var(--wg-color-danger)',success:'var(--wg-color-success)'};
  function model() {
    const values = scenario === 'balanced' ? [50,30,70,20,40,60,80] : [1,2,3,4,5];
    let tree = null;
    for (const value of values) {
      const node = {value,left:null,right:null};
      if (!tree) tree = node;
      else { let cur=tree; while(true) { const side=value<cur.value?'left':'right'; if(!cur[side]){cur[side]=node;break;} cur=cur[side]; } }
    }
    const path=[]; let cur=tree, code='';
    while(cur){const left=key<cur.value;path.push({value:cur.value,code,left});code+=left?'L':'R';cur=left?cur.left:cur.right;}
    return {tree,path,code,values};
  }
  function draw() {
    const m=model(), path=m.path, complete=review?answered:step===path.length;
    q('#target').textContent='待插入 k = '+key;
    q('#sequence').textContent=review?'已有键：50、30、70、20、40、60、80':'已有键的插入顺序：'+m.values.join(' → ');
    svg.setAttribute('viewBox',`0 0 ${width} 340`);
    const nodes=[], slots=[], edges=[];
    function visit(n,code,depth,lo,hi,parent) {
      let x=(lo+hi)/2, y=38+depth*74;
      if(scenario==='chain'){x=width*(.18+.12*depth);y=30+depth*54;}
      const point={x,y,code,value:n?n.value:null};
      if(!n) {
        if(scenario==='chain' && code!==m.code)return;
        slots.push(point);
      } else nodes.push(point);
      if(parent)edges.push({a:parent,b:point});
      if(n){visit(n.left,code+'L',depth+1,lo,(lo+hi)/2,point);visit(n.right,code+'R',depth+1,(lo+hi)/2,hi,point);}
    }
    visit(m.tree,'',0,8,width-8,null);
    const traversed=new Set();
    if(!review || answered){for(let i=0;i<(review?path.length:step);i++)traversed.add(path[i].code+(path[i].left?'L':'R'));}
    let html='';
    for(const e of edges){const active=traversed.has(e.b.code);html+=`<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" stroke="${active?C.accent:C.border}" stroke-width="${active?3:2}" ${e.b.value===null?'stroke-dasharray="4 4"':''}/>`;}
    for(const n of nodes){const active=(!review && !complete && path[step].code===n.code);const visited=(!review||answered)&&path.slice(0,review?path.length:step).some(p=>p.code===n.code);html+=`<g><circle cx="${n.x}" cy="${n.y}" r="19" fill="${C.surface}" stroke="${active||visited?C.accent:C.muted}" stroke-width="${active?3:1.5}"/><text x="${n.x}" y="${n.y+5}" text-anchor="middle" fill="${active||visited?C.accent:C.text}" font-weight="600">${n.value}</text></g>`;}
    for(const s of slots){const newLeaf=complete&&s.code===m.code;const wrong=review&&answered&&!correctAnswer&&s.code===chosen;const parentValue=nodes.find(n=>n.code===s.code.slice(0,-1)).value;const side=s.code.endsWith('L')?'左':'右';const interactive=review&&!answered;
      html+=`<g id="slot-${s.code}" ${interactive?`data-slot="${s.code}" role="button" tabindex="0" aria-label="${parentValue} 的${side}孩子空位"`:''}><rect x="${s.x-18}" y="${s.y-20}" width="36" height="40" fill="transparent"/><circle cx="${s.x}" cy="${s.y}" r="${newLeaf?17:11}" fill="${newLeaf?C.accent:C.background}" stroke="${wrong?C.danger:newLeaf?C.accent:C.muted}" stroke-width="${wrong?3:1.5}"/>${newLeaf?`<text x="${s.x}" y="${s.y+5}" fill="var(--wg-color-on-accent)" text-anchor="middle" font-weight="600">${key}</text>`:wrong?`<text x="${s.x}" y="${s.y+5}" text-anchor="middle" fill="${C.danger}">×</text>`:''}</g>`;
    }
    svg.innerHTML=html;
    const route=path.map(p=>p.value).join(' → ');
    const last=path[path.length-1];
    if(review){
      q('#status').innerHTML=answered?`<strong style="color:${correctAnswer?C.success:C.danger}">${correctAnswer?'正确':'还差一步'}：35 是 40 的左孩子</strong><span>比较路径 50 → 30 → 40：35 &lt; 50，35 &gt; 30，35 &lt; 40，最后在空位成为叶子。</span><div class="stats"><span>比较 3 次</span><span>新结点深度 3</span></div>`:`<strong>35 应放在哪里？</strong><span class="muted">选择一个空位置。不要移动任何已有结点。</span>`;
    }else{
      if(complete){q('#status').innerHTML=`<strong>找到空位，插入 ${key}</strong><span>路径 ${route}；${key} 成为 ${last.value} 的${last.left?'左':'右'}孩子。</span><div class="stats"><span>比较 ${step} 次</span><span>新叶子深度 ${path.length}</span></div>`;}
      else {const p=path[step];q('#status').innerHTML=`<strong>待比较：${key} ${p.left?'&lt;':'&gt;'} ${p.value} → 向${p.left?'左':'右'}</strong><span class="muted">${step===0?'从根开始；每次比较只沿一条分支向下。':'已经走过：'+path.slice(0,step).map(p=>p.value).join(' → ')}</span><div class="stats"><span>已比较 ${step} 次</span><span>当前结点深度 ${step}</span></div>`;}
      q('#next').disabled=complete;q('#next').textContent=complete?'插入完成':step===path.length-1?'比较并插入':'下一次比较';
      q('#balanced').classList.toggle('active',scenario==='balanced');q('#chain').classList.toggle('active',scenario==='chain');q('#keys').style.display=scenario==='balanced'?'flex':'none';
      root.querySelectorAll('[data-key]').forEach(b=>b.classList.toggle('active',Number(b.dataset.key)===key));
    }
  }
  function answer(code){
    if(!review||answered)return;
    const m=model();chosen=code;correctAnswer=code===m.code;answered=true;draw();
    const parentCode=code.slice(0,-1);let n=m.tree;for(const side of parentCode)n=side==='L'?n.left:n.right;
    ctx.submitResult({outcome:correctAnswer?'correct':'incorrect',score:correctAnswer?1:0,detail:`将 35 放在 ${n.value} 的${code.endsWith('L')?'左':'右'}孩子空位。`,response:{key:35,slot:code,expected:m.code}});
  }
  root.addEventListener('click',e=>{
    const slot=e.target.closest('[data-slot]');if(slot){answer(slot.dataset.slot);return;}
    if(review)return;
    const button=e.target.closest('button');if(!button)return;
    if(button.id==='next'){step=Math.min(model().path.length,step+1);}
    else if(button.id==='reset')step=0;
    else if(button.id==='balanced'){scenario='balanced';key=35;step=0;}
    else if(button.id==='chain'){scenario='chain';key=6;step=0;}
    else if(button.dataset.key){key=Number(button.dataset.key);step=0;}
    draw();
  },{signal});
  svg.addEventListener('keydown',e=>{const slot=e.target.closest('[data-slot]');if(slot&&(e.key==='Enter'||e.key===' ')){e.preventDefault();answer(slot.dataset.slot);}},{signal});
  function resize(){const next=Math.max(280,svg.getBoundingClientRect().width||root.clientWidth-34);if(Math.abs(width-next)>.5){width=next;draw();}}
  width=Math.max(280,root.clientWidth-34);draw();
  const observer=new ResizeObserver(resize);observer.observe(root);resize();
  return ()=>observer.disconnect();
}