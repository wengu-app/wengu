export function mount(root, ctx) {
  const review = ctx.mode === 'review';
  let angle = review ? 210 : 120;
  let selected = null, answered = false, playing = false, raf = 0, last = 0;
  const options = [{id:'positive-half', value:0.5, label:'1/2'}, {id:'negative-half', value:-0.5, label:'−1/2'}, {id:'negative-root', value:-Math.sqrt(3)/2, label:'−√3/2'}];
  root.innerHTML = `<style>
    .uc {font-family:var(--wg-font-sans); color:var(--wg-color-text); padding:16px; line-height:1.55; max-width:960px; margin:auto; box-sizing:border-box;}
    .uc * {box-sizing:border-box;} .uc h2 {font-size:20px; margin:0 0 6px;} .uc p {margin:0;} .uc .intro {font-size:14px;color:var(--wg-color-text-muted);margin-bottom:16px;}
    .uc .panels {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px;}
    .uc .panel {border:1px solid var(--wg-color-border);border-radius:12px;overflow:hidden; background:var(--wg-color-surface);}
    .uc h3 {font-size:14px;font-weight:600;margin:12px 16px 0;}
    .uc svg {display:block;width:100%;height:270px;overflow:hidden;} .uc svg text {font-family:var(--wg-font-sans);font-size:13px;fill:var(--wg-color-text);}
    .uc .axis {stroke:var(--wg-color-text-muted);stroke-width:1;} .uc .grid {stroke:var(--wg-color-border);stroke-width:1;}
    .uc .accent {stroke:var(--wg-color-accent);} .uc .muted {fill:var(--wg-color-text-muted);} .uc .dot {fill:var(--wg-color-accent);stroke:var(--wg-color-surface);stroke-width:2;}
    .uc .readout {margin:12px 0;padding:12px 14px;background:var(--wg-color-background);border-radius:10px;min-height:52px;font-size:15px;}
    .uc .controls {display:flex;gap:10px;align-items:center;flex-wrap:wrap;} .uc label {font-size:14px;} .uc input {flex:1;min-width:150px;accent-color:var(--wg-color-accent);height:30px;}
    .uc button {border:1px solid var(--wg-color-border);background:var(--wg-color-surface);color:var(--wg-color-text);padding:9px 14px;border-radius:8px;font:inherit;font-size:14px;cursor:pointer;min-height:42px;}
    .uc button:hover:not(:disabled) {border-color:var(--wg-color-accent);} .uc button:focus-visible,.uc input:focus-visible {outline:2px solid var(--wg-color-accent);outline-offset:3px;}
    .uc button.primary,.uc button[aria-pressed="true"] {background:var(--wg-color-accent);color:var(--wg-color-on-accent);border-color:var(--wg-color-accent);}
    .uc button:disabled {cursor:default;opacity:.6;} .uc .keys {display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;} .uc .note {font-size:14px;margin-top:14px;color:var(--wg-color-text-muted);min-height:44px;}
    .uc .choices {display:flex;gap:8px;flex-wrap:wrap;} .uc .choices button {flex:1;min-width:80px;} .uc #check {margin-top:12px;} .uc .feedback {margin-top:12px;min-height:52px;font-size:14px;}
  </style>
  <section class="uc">
    <h2>${review ? '为正弦曲线放置一个点' : '圆上的高度，就是正弦值'}</h2>
    <p class="intro">${review ? 'α = 7π/6（210°）时，曲线上的点应放在哪个高度？选择后提交。' : '拖动角度：圆上的点逆时针转动，右侧记录它的纵坐标。'}</p>
    <div class="panels">
      <section class="panel"><h3>单位圆 · 半径为 1</h3><svg id="circle" viewBox="0 0 320 270" role="img" aria-label="角的终边与单位圆的交点"></svg></section>
      <section class="panel"><h3>${review ? '待放置的曲线点' : '纵坐标随角度的变化'}</h3><svg id="graph" viewBox="0 0 320 270" role="img" aria-label="正弦值与角度的对应图"></svg></section>
    </div>
    <div class="readout" id="readout" aria-live="polite"></div>
    ${review ? `<div class="choices" role="group" aria-label="选择纵坐标">${options.map(o=>`<button id="choice-${o.id}" aria-pressed="false">${o.label}</button>`).join('')}</div><button class="primary" id="check" disabled>确认位置</button><div id="feedback" class="feedback" aria-live="polite"></div>` : `<div class="controls"><button id="play">播放一周</button><label for="angle">角度 α</label><input id="angle" type="range" min="0" max="360" step="1" value="120" aria-label="角度，单位为度"></div><div class="keys" aria-label="关键角度">${[0,90,180,270,360].map((v,i)=>`<button data-angle="${v}">${['0','π/2','π','3π/2','2π'][i]}</button>`).join('')}</div><p class="note" id="note"></p>`}
  </section>`;
  const el = s => root.querySelector(s);
  const circle = el('#circle'), graph = el('#graph');
  const gcd = (a,b) => b ? gcd(b,a%b) : a;
  function angleText(a) { if(a===0)return '0'; const d=gcd(a,180), n=a/d, q=180/d; return (n===1?'':n)+'π'+(q===1?'':'/'+q); }
  function num(v) { return Math.abs(v)<0.00001 ? '0' : v.toFixed(3).replace(/\.000$/,'').replace('-', '−'); }
  function line(x1,y1,x2,y2,cls,extra='') { return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" ${extra}/>`; }
  function text(x,y,s,extra='') { return `<text x="${x}" y="${y}" ${extra}>${s}</text>`; }
  function draw() {
    const a=angle*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
    const cx=150, cy=122, r=78, px=cx+r*c, py=cy-r*s;
    const reveal=!review||answered;
    let arc='';
    for(let i=0;i<=Math.max(1,Math.ceil(angle/5));i++) {const t=a*i/Math.max(1,Math.ceil(angle/5));arc+=(i?' L':'M')+(cx+23*Math.cos(t))+','+(cy-23*Math.sin(t));}
    let h = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--wg-color-border)" stroke-width="2"/>`;
    h+=line(38,cy,267,cy,'axis')+line(cx,22,cx,217,'axis');
    h+=text(271,127,'x')+text(157,25,'y')+text(134,140,'O');
    h+=text(233,140,'1')+text(56,140,'−1')+text(134,48,'1')+text(126,204,'−1');
    h+=line(cx,cy,cx+r,cy,'accent','stroke-width="3" opacity=".45"');
    h+=`<path d="${arc}" fill="none" class="accent" stroke-width="1.5"/>`+text(179,151,'α');
    if(reveal) {
      h+=line(px,py,cx,py,'accent','stroke-dasharray="4 4" opacity=".6"');
      h+=line(cx,cy,cx,py,'accent','stroke-width="5"');
      h+=line(px,py,px,cy,'grid','stroke-dasharray="4 4"');
    }
    h+=line(cx,cy,px,py,'axis','stroke-width="2"');
    h+=`<circle cx="${px}" cy="${py}" r="6" class="dot"/>`+text(px+(c>=0?12:-20),py+(s>=0?-10:20),'P');
    h+=text(160,245,reveal ? `P = (${num(c)}, ${num(s)})` : 'P：角的终边与圆的交点','text-anchor="middle"');
    circle.innerHTML=h;
    const x0=33, x1=292, gx=x0+(x1-x0)*angle/360;
    let g='';
    [1,-1].forEach(v=>{const y=cy-r*v;g+=line(x0,y,x1,y,'grid')+text(25,y+5,v===1?'1':'−1','text-anchor="end"');});
    const labels=['0','π/2','π','3π/2','2π'];
    labels.forEach((v,i)=>{const x=x0+(x1-x0)*i/4;g+=line(x,44,x,200,'grid')+text(x,224,v,'text-anchor="middle"');});
    g+=line(x0,24,x0,205,'axis')+line(x0,cy,303,cy,'axis')+text(14,cy+5,'0')+text(21,23,'y');
    g+=text(160,250,'角度 α（弧度）','text-anchor="middle"');
    if(reveal) {
      let path=''; for(let i=0;i<=180;i++){const t=i/180;path+=(i?' L':'M')+(x0+(x1-x0)*t)+','+(cy-r*Math.sin(t*2*Math.PI));}
      g+=`<path d="${path}" fill="none" class="accent" stroke-width="2.5"/>`;
      g+=line(gx,cy,gx,py,'accent','stroke-width="5"')+line(x0,py,gx,py,'accent','stroke-dasharray="4 4" opacity=".55"');
      g+=`<circle cx="${gx}" cy="${py}" r="6" class="dot"/>`;
      g+=text(211,23,'y = sin α','text-anchor="middle"');
    } else {
      g+=line(gx,38,gx,204,'accent','stroke-dasharray="4 4" opacity=".7"');
      g+=text(gx,25,'α = 7π/6','text-anchor="middle"');
      if(selected!==null) g+=`<circle cx="${gx}" cy="${cy-r*options[selected].value}" r="7" class="dot"/>`;
      else g+=text(gx,112,'?','text-anchor="middle"');
    }
    if(review&&answered&&selected!==1) g+=`<circle cx="${gx}" cy="${cy-r*options[selected].value}" r="7" fill="none" stroke="var(--wg-color-danger)" stroke-width="2"/>`;
    graph.innerHTML=g;
    if(review) el('#readout').textContent=answered ? 'sin(7π/6) = −1/2：取 P 的纵坐标。' : (selected===null ? '在下方选择高度，把点放到虚线上。' : '已放置：y = '+options[selected].label+'。确认这个位置吗？');
    else {
      el('#readout').textContent=`α = ${angleText(angle)}（${angle}°）　sin α = ${num(s)}`;
      const note=angle===0||angle===180||angle===360 ? 'P 落在 x 轴上，纵坐标为 0。' : angle===90 ? 'P 到达最高点：sin(π/2) = 1。' : angle===270 ? 'P 到达最低点：sin(3π/2) = −1。' : s>0 ? 'P 在 x 轴上方：第一、二象限的正弦值都为正。' : 'P 在 x 轴下方：第三、四象限的正弦值都为负。';
      el('#note').textContent=note+' 转过 2π 后高度重复，正弦函数的周期为 2π。';
    }
  }
  const on=(target,type,fn)=>target.addEventListener(type,fn,{signal:ctx.signal});
  function stop(){playing=false;cancelAnimationFrame(raf);if(!review)el('#play').textContent='播放一周';}
  if(review) {
    options.forEach((o,i)=>on(el('#choice-'+o.id),'click',()=>{
      if(answered)return; selected=i;
      options.forEach((v,j)=>el('#choice-'+v.id).setAttribute('aria-pressed',String(i===j)));
      el('#check').disabled=false; draw();
    }));
    on(el('#check'),'click',()=>{
      if(answered||selected===null)return;
      answered=true; const correct=selected===1;
      options.forEach(o=>el('#choice-'+o.id).disabled=true);el('#check').disabled=true;
      draw();
      el('#feedback').textContent=(correct?'正确。':'还不对。')+' P 的纵坐标为 −1/2，所以曲线点应在 y = −1/2 处；横坐标 −√3/2 是余弦值。';
      el('#feedback').style.color=correct?'var(--wg-color-success)':'var(--wg-color-danger)';
      ctx.submitResult({outcome:correct?'correct':'incorrect',score:correct?1:0,detail:'选择 sin(7π/6) = '+options[selected].label,response:{angle:210,value:options[selected].value}});
    });
  } else {
    on(el('#angle'),'input',e=>{stop();angle=Number(e.target.value);draw();});
    root.querySelectorAll('[data-angle]').forEach(b=>on(b,'click',()=>{stop();angle=Number(b.dataset.angle);el('#angle').value=angle;draw();}));
    let continuous=0;
    function frame(now){if(!playing)return; const dt=Math.min((now-last)/1000,.1);last=now;continuous+=dt*36;angle=Math.min(360,Math.round(continuous));el('#angle').value=angle;draw();if(continuous>=360){stop();return;}raf=requestAnimationFrame(frame);}
    on(el('#play'),'click',()=>{if(playing){stop();return;}angle=0;continuous=0;el('#angle').value=0;playing=true;last=performance.now();el('#play').textContent='暂停';draw();raf=requestAnimationFrame(frame);});
  }
  draw();
  return ()=>{cancelAnimationFrame(raf);playing=false;};
}
