export function mount(root, ctx) {
  const review = ctx.mode === 'review';
  const g = 9.8;
  let speed = 20, angle = 45, phase = 0.5, compare = false, answered = false;
  let playing = false, raf = 0, last = 0, width = 600;
  const signal = ctx.signal;
  root.innerHTML = `<style>
    .projectile{font-family:var(--wg-font-sans);color:var(--wg-color-text);padding:16px;box-sizing:border-box;max-width:1000px;margin:auto;font-size:14px;line-height:1.55}
    .projectile *{box-sizing:border-box}.projectile h2{font-size:20px;margin:0 0 5px}.projectile p{margin:0}.projectile .muted{color:var(--wg-color-text-muted);font-size:13px}
    .projectile .scene{width:100%;display:block;background:var(--wg-color-background);border:1px solid var(--wg-color-border);border-radius:12px;margin-top:14px}
    .projectile .legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;margin:9px 0}.projectile .blue{color:var(--wg-color-accent)}.projectile .orange{color:var(--wg-color-categorical-1)}
    .projectile .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.projectile .stat{background:var(--wg-color-background);border-radius:8px;padding:9px}.projectile .stat span{display:block;color:var(--wg-color-text-muted);font-size:12px}.projectile .stat strong{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}
    .projectile .controls{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin-top:14px}.projectile label{display:block}.projectile .row{display:flex;justify-content:space-between;gap:8px}.projectile output{font-variant-numeric:tabular-nums}.projectile input[type=range]{width:100%;accent-color:var(--wg-color-accent);margin:8px 0;cursor:pointer}.projectile .time{grid-column:1/-1}
    .projectile button{font:inherit;color:var(--wg-color-text);background:var(--wg-color-surface);border:1px solid var(--wg-color-border);border-radius:8px;padding:7px 12px;cursor:pointer;min-height:38px}.projectile button:hover:not(:disabled){border-color:var(--wg-color-accent)}.projectile button:focus-visible,.projectile input:focus-visible{outline:2px solid var(--wg-color-accent);outline-offset:3px}.projectile button:disabled{cursor:default}.projectile button[aria-pressed=true]{color:var(--wg-color-accent);border-color:var(--wg-color-accent)}
    .projectile .buttons{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}.projectile .note{padding:12px;border-left:3px solid var(--wg-color-accent);background:var(--wg-color-background);border-radius:4px;min-height:70px}.projectile .formula{margin-top:10px;font-size:13px;color:var(--wg-color-text-muted)}
    .projectile .answers{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.projectile .answer{padding:8px 3px}.projectile .answer svg{display:block;width:100%;height:77px}.projectile .answer span{display:block;font-size:13px}.projectile .answer.good{border:2px solid var(--wg-color-success)}.projectile .answer.bad{border:2px solid var(--wg-color-danger)}
    @media(max-width:440px){.projectile{padding:12px}.projectile h2{font-size:18px}.projectile .stat{padding:7px}.projectile .stat strong{font-size:14px}.projectile .controls{gap:8px 14px}}
  </style>
  <section class="projectile">
    <h2>${review ? '最高点，速度还剩什么？' : '一条轨迹，两个分运动'}</h2>
    <p class="muted">${review ? '不计空气阻力。物体斜向上抛出，现已到达最高点。' : '不计空气阻力 · 同一水平面落地 · g = 9.8 m/s²'}</p>
    <svg class="scene" role="img" aria-label="斜抛运动轨迹及分运动投影"></svg>
    <div class="legend">${review ? '<span>实心圆：最高点处的物体</span>' : '<span class="blue">蓝色 → 水平速度</span><span class="orange">橙色 ↑↓ 竖直速度</span><span>小圆点：等时间隔的位置</span>'}</div>
    ${review ? `<p>哪幅图正确表示此时的两个速度分量？</p><div class="answers">
      <button type="button" class="answer" id="answer-down" aria-label="水平速度向右，竖直速度向下"><svg viewBox="0 0 150 77" aria-hidden="true"><circle cx="40" cy="22" r="5" fill="currentColor"/><path d="M47 22H114m-8-5 8 5-8 5" fill="none" stroke="var(--wg-color-accent)" stroke-width="3"/><path d="M40 29V65m-5-8 5 8 5-8" fill="none" stroke="var(--wg-color-categorical-1)" stroke-width="3"/></svg><span>水平向右<br>竖直向下</span></button>
      <button type="button" class="answer" id="answer-right" aria-label="水平速度向右，竖直速度为零"><svg viewBox="0 0 150 77" aria-hidden="true"><circle cx="30" cy="28" r="5" fill="currentColor"/><path d="M37 28H120m-8-5 8 5-8 5" fill="none" stroke="var(--wg-color-accent)" stroke-width="3"/><text x="75" y="64" text-anchor="middle" font-size="16" fill="var(--wg-color-text)">vᵧ = 0</text></svg><span>水平向右<br>竖直为零</span></button>
      <button type="button" class="answer" id="answer-stop" aria-label="水平和竖直速度均为零"><svg viewBox="0 0 150 77" aria-hidden="true"><circle cx="75" cy="24" r="5" fill="currentColor"/><text x="75" y="62" text-anchor="middle" font-size="16" fill="var(--wg-color-text)">vₓ = vᵧ = 0</text></svg><span>水平为零<br>竖直为零</span></button>
    </div>` : `<div class="controls">
      <label><span class="row"><span>初速度 v₀</span><output id="speed-value"></output></span><input id="speed" aria-label="初速度，米每秒" type="range" min="10" max="24" step="1" value="20"></label>
      <label><span class="row"><span>仰角 θ</span><output id="angle-value"></output></span><input id="angle" aria-label="仰角，度" type="range" min="15" max="75" step="1" value="45"></label>
      <label class="time"><span class="row"><span>拖动时间，观察分运动</span><output id="time-value"></output></span><input id="time" aria-label="飞行进度，百分比" type="range" min="0" max="100" step="0.1" value="50"></label>
    </div><div class="buttons"><button type="button" id="play">播放</button><button type="button" id="apex">到最高点</button><button type="button" id="complement" aria-pressed="false">对比互余角</button></div>`}
    <div class="stats" ${review ? 'hidden style="display:none"' : ''}>
      <div class="stat"><span>水平速度 vₓ</span><strong id="vx"></strong></div><div class="stat"><span>竖直速度 vᵧ</span><strong id="vy"></strong></div><div class="stat"><span>加速度 aᵧ</span><strong>−9.8 m/s²</strong></div>
    </div>
    <div class="note" aria-live="polite" id="feedback">${review ? '请点选一幅速度图。注意：速度与加速度不是同一个量。' : ''}</div>
    <div class="formula" id="formula" ${review ? 'hidden' : ''}></div>
  </section>`;
  const q = s => root.querySelector(s);
  const svg = q('.scene');
  const color = {text:'var(--wg-color-text)',muted:'var(--wg-color-text-muted)',border:'var(--wg-color-border)',blue:'var(--wg-color-accent)',orange:'var(--wg-color-categorical-1)',surface:'var(--wg-color-surface)'};
  function values(a = angle) {
    const rad = a * Math.PI / 180, vx = speed * Math.cos(rad), u = speed * Math.sin(rad);
    const T = 2 * u / g, R = vx * T, t = phase * T;
    return {vx,u,T,R,t,x:vx*t,y:u*t-g*t*t/2,vy:u-g*t};
  }
  function num(n) { return (Math.abs(n)<0.005 ? 0 : n).toFixed(2); }
  function line(x1,y1,x2,y2,c,dash='',sw=1.5) { return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`; }
  function dot(x,y,r,c,fill=c) { return `<circle cx="${x}" cy="${y}" r="${r}" stroke="${c}" stroke-width="1.5" fill="${fill}"/>`; }
  function text(x,y,s,anchor='start',c=color.muted) { return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="12" fill="${c}">${s}</text>`; }
  function arrow(x,y,dx,dy,c) {
    const length = Math.hypot(dx,dy); if(length<0.2)return '';
    const ex=x+dx,ey=y+dy,ux=dx/length,uy=dy/length;
    return line(x,y,ex,ey,c,'',3)+`<path d="M${ex-7*ux+4*uy},${ey-7*uy-4*ux} L${ex},${ey} L${ex-7*ux-4*uy},${ey-7*uy+4*ux}" fill="none" stroke="${c}" stroke-width="2.5"/>`;
  }
  function draw() {
    const v=values(), w=width, h=Math.max(255,Math.min(340,w*0.53)), ground=h-83, ox=35;
    const D=speed*speed/g, scale=Math.min((w-98)/(D*1.08),(ground-30)/(D/2));
    const X=x=>ox+x*scale,Y=y=>ground-y*scale;
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('height',String(h));
    function path(a) {
      const p=values(a);let d='';
      for(let i=0;i<=60;i++){const t=p.T*i/60;d+=`${i?'L':'M'}${X(p.vx*t)},${Y(p.u*t-g*t*t/2)} `;}
      return d;
    }
    let s=line(ox,ground,w-34,ground,color.muted)+line(ox,ground,ox,22,color.muted)+text(7,18,'y / m')+text(w-35,ground+19,'x / m','end');
    s+=text(ox-8,ground+17,'0','end');
    for(let i=1;i<=3;i++) {const x=D*i/3; s+=line(X(x),ground-3,X(x),ground+3,color.muted)+text(X(x),ground+19,x.toFixed(0),'middle');}
    if(!review || answered) {
      s+=line(ox,ground+48,w-34,ground+48,color.border)+line(w-18,25,w-18,ground,color.border);
      s+=text(ox,h-8,'水平投影：等时位移相等')+text(w-8,16,'竖直投影','end');
      for(let i=0;i<=10;i++) {const t=v.T*i/10,x=v.vx*t,y=v.u*t-g*t*t/2;s+=dot(X(x),ground+48,2.5,color.blue,color.surface)+dot(w-18,Y(y),2.5,color.orange,color.surface);}
    }
    if(compare && !review) s+=`<path d="${path(90-angle)}" fill="none" stroke="${color.orange}" stroke-width="2" stroke-dasharray="6 5"/>`;
    s+=`<path d="${path(angle)}" fill="none" stroke="${color.blue}" stroke-width="2.5"/>`;
    if(!review || answered) {
      for(let i=0;i<=10;i++){const t=v.T*i/10;s+=dot(X(v.vx*t),Y(v.u*t-g*t*t/2),3,color.blue,color.surface);}
      s+=line(X(v.x),Y(v.y),X(v.x),ground+48,color.blue,'3 5',1)+line(X(v.x),Y(v.y),w-18,Y(v.y),color.orange,'3 5',1);
      s+=dot(X(v.x),ground+48,5,color.blue)+dot(w-18,Y(v.y),5,color.orange);
      s+=arrow(X(v.x),Y(v.y),v.vx*2,0,color.blue)+arrow(X(v.x),Y(v.y),0,-v.vy*2,color.orange);
    }
    s+=dot(X(v.x),Y(v.y),6,color.text);
    if(Math.abs(phase-0.5)<0.001)s+=text(X(v.x),Y(v.y)-15,'最高点','middle',color.text);
    svg.innerHTML=s;
    q('#vx').textContent=num(v.vx)+' m/s';q('#vy').textContent=num(v.vy)+' m/s';
    if(!review){
      q('#speed-value').textContent=speed+' m/s';q('#angle-value').textContent=angle+'°';q('#time-value').textContent=num(v.t)+' / '+num(v.T)+' s';
      q('#time').value=String(phase*100);
      q('#feedback').textContent=compare ? `实线 ${angle}°，虚线 ${90-angle}°：射程均为 ${num(v.R)} m，飞行时间分别为 ${num(v.T)} s 和 ${num(values(90-angle).T)} s。${angle===45?'两个角相同，轨迹完全重合。':'射程相同，不代表轨迹与飞行时间相同。'}` : Math.abs(phase-0.5)<0.001 ? '最高点：竖直速度为零，水平速度仍不为零；重力没有消失，加速度仍竖直向下。' : '水平速度始终不变；竖直速度随时间均匀减小，由向上变为向下。正方向取向右、向上。';
    }
    q('#formula').innerHTML=`vₓ = v₀ cosθ　　vᵧ = v₀ sinθ − gt<br>飞行时间 T = 2v₀ sinθ / g = ${num(v.T)} s<br>射程 R = v₀² sin2θ / g = ${num(v.R)} m；v₀ 一定时，45° 射程最大。`;
  }
  function stop(){playing=false;cancelAnimationFrame(raf);if(q('#play'))q('#play').textContent='播放';}
  function frame(now){if(!playing)return;const dt=Math.min((now-last)/1000,0.08);last=now;phase=Math.min(1,phase+dt/values().T);draw();if(phase>=1)stop();else raf=requestAnimationFrame(frame);}
  if(!review){
    q('#speed').addEventListener('input',e=>{speed=Number(e.target.value);draw();},{signal});
    q('#angle').addEventListener('input',e=>{angle=Number(e.target.value);draw();},{signal});
    q('#time').addEventListener('input',e=>{stop();phase=Number(e.target.value)/100;draw();},{signal});
    q('#apex').addEventListener('click',()=>{stop();phase=0.5;draw();},{signal});
    q('#complement').addEventListener('click',()=>{compare=!compare;q('#complement').setAttribute('aria-pressed',String(compare));draw();},{signal});
    q('#play').addEventListener('click',()=>{if(playing){stop();return;}if(phase>=1)phase=0;playing=true;q('#play').textContent='暂停';last=performance.now();raf=requestAnimationFrame(frame);},{signal});
  } else {
    const descriptions={right:'水平向右，竖直为零',down:'水平向右，竖直向下',stop:'水平和竖直速度均为零'};
    for(const choice of ['down','right','stop'])q('#answer-'+choice).addEventListener('click',()=>{
      if(answered)return;answered=true;
      const correct=choice==='right';
      root.querySelectorAll('.answer').forEach(b=>{b.disabled=true;});
      q('#answer-right').classList.add('good');if(!correct)q('#answer-'+choice).classList.add('bad');
      q('.stats').hidden=false;q('.stats').style.display='grid';q('#formula').hidden=false;
      q('#feedback').textContent=(correct?'正确。':'不正确。')+'最高点只有竖直速度为零，水平速度保持不变；向下的是重力加速度，不是此刻的竖直速度。';
      draw();
      ctx.submitResult({outcome:correct?'correct':'incorrect',score:correct?1:0,detail:'最高点速度分解：'+descriptions[choice],response:{choice}});
    },{signal});
  }
  function resize(){const next=q('.projectile').clientWidth-2*(q('.projectile').clientWidth<440?12:16);width=Math.max(280,svg.clientWidth||next);draw();}
  const observer=new ResizeObserver(resize);observer.observe(root);resize();
  return ()=>{stop();observer.disconnect();};
}