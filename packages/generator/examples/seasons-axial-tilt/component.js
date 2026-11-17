export function mount(root, ctx) {
  const review = ctx.mode === 'review';
  let selected = 0, tilted = true, answered = false, chosen = null, width = 600;
  const seasons = ['夏至', '秋分', '冬至', '春分'];
  const dates = ['约6月22日', '约9月23日', '约12月22日', '约3月21日'];
  const letters = ['甲', '乙', '丙', '丁'];
  const ns = 'http://www.w3.org/2000/svg';
  root.innerHTML = `<style>
    .season-widget{font-family:var(--wg-font-sans);color:var(--wg-color-text);padding:16px;box-sizing:border-box;max-width:900px;margin:auto;font-size:15px;line-height:1.55}
    .season-widget *{box-sizing:border-box}.season-widget h2{font-size:20px;margin:0 0 6px}.season-widget p{margin:0}
    .season-widget .muted{color:var(--wg-color-text-muted);font-size:13px}.season-widget .orbit{width:100%;height:330px;display:block}
    .season-widget .planet{cursor:pointer;outline:none}.season-widget .planet[aria-disabled=false]:focus .halo{stroke:var(--wg-color-accent);stroke-width:3}.season-widget .planet[aria-disabled=false]:hover .halo{stroke:var(--wg-color-accent)}.season-widget .planet[aria-disabled=true]{cursor:default}
    .season-widget .tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:8px 0 14px}
    .season-widget button{font:inherit;padding:8px 12px;color:var(--wg-color-text);background:var(--wg-color-surface);border:1px solid var(--wg-color-border);border-radius:8px;cursor:pointer}
    .season-widget button[aria-pressed=true]{color:var(--wg-color-accent);border-color:var(--wg-color-accent)}
    .season-widget button:focus-visible{outline:2px solid var(--wg-color-accent);outline-offset:3px}
    .season-widget .details{border:1px solid var(--wg-color-border);border-radius:12px;padding:14px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;background:var(--wg-color-background)}
    .season-widget .section{display:block;width:300px;max-width:100%;height:244px;margin:auto}.season-widget .stats{flex:1;min-width:220px}
    .season-widget .stat-title{font-size:17px;font-weight:650;margin:0 0 10px}.season-widget .row{display:flex;justify-content:space-between;gap:10px;margin:7px 0}.season-widget .row strong{color:var(--wg-color-accent)}
    .season-widget .daybar{height:14px;display:flex;border-radius:7px;overflow:hidden;background:var(--wg-color-border);margin:10px 0 4px}.season-widget .day{background:var(--wg-color-warning)}
    .season-widget .takeaway{font-size:14px;margin-top:12px}.season-widget .note{margin-top:12px;font-size:13px;color:var(--wg-color-text-muted)}
    .season-widget .feedback{padding:12px;border-left:3px solid var(--wg-color-accent);background:var(--wg-color-background);margin:8px 0 14px}.season-widget [hidden]{display:none!important}
  </style>
  <section class="season-widget">
    <h2>${review ? '找出北半球的夏至' : '地轴不改方向，四季却在变化'}</h2>
    <p class="intro">${review ? '地轴北端的指向基本不变。点击北半球处于夏至的地球位置。' : '点击不同位置：观察同样倾斜的地轴，怎样改变两半球受光。'}</p>
    <svg class="orbit" role="group" aria-label="地球公转与地轴方向示意图"></svg>
    <p class="muted">轨道与大小不按比例；虚线为轨道面垂线的投影。</p>
    <div class="tools" ${review ? 'hidden' : ''}><button type="button" id="tilt-toggle" aria-pressed="false">对照：若地轴不倾斜</button><span class="muted" id="tilt-label">地轴倾斜约23.5°，方向基本不变</span></div>
    <div class="feedback" role="status" hidden></div>
    <div class="details" ${review ? 'hidden' : ''}>
      <svg class="section" viewBox="0 0 300 244" role="img" aria-label="太阳直射点随季节改变的地球剖面"></svg>
      <div class="stats"><div class="stat-title"></div><div class="row"><span>太阳直射纬度</span><strong id="latitude"></strong></div><p class="muted">以北纬40°为例</p><div class="row"><span>正午太阳高度</span><strong id="altitude"></strong></div><div class="daybar"><div class="day"></div></div><div class="row muted"><span id="day-label"></span><span id="night-label"></span></div><p class="takeaway"></p></div>
    </div>
    <p class="note" ${review ? 'hidden' : ''}>四季不是日地距离造成的：1月初地球经过近日点，北半球反而是冬季。实际轨道略呈椭圆。</p>
  </section>`;
  const q = s => root.querySelector(s);
  const orbit = q('.orbit'), section = q('.section');
  function node(tag, attrs, parent, text) {
    const el = document.createElementNS(ns, tag);
    for (const [k,v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    if (text !== undefined) el.textContent = text;
    parent.appendChild(el); return el;
  }
  const color = name => `var(--wg-color-${name})`;
  function text(parent,x,y,value,attrs={}) { return node('text',{x,y,fill:color('text'),'font-size':13,'text-anchor':'middle',...attrs},parent,value); }
  function line(parent,x1,y1,x2,y2,attrs={}) { return node('line',{x1,y1,x2,y2,stroke:color('text-muted'),'stroke-width':1.5,...attrs},parent); }
  function drawOrbit() {
    orbit.replaceChildren(); orbit.setAttribute('viewBox',`0 0 ${width} 330`);
    const cx=width/2, cy=160, rx=cx-51, ry=90;
    node('ellipse',{cx,cy,rx,ry,fill:'none',stroke:color('text-muted'),'stroke-opacity':0.65,'stroke-width':1.5},orbit);
    node('circle',{cx,cy,r:24,fill:color('warning'),'fill-opacity':0.18,stroke:color('warning'),'stroke-width':2},orbit);
    text(orbit,cx,165,'太阳',{'font-size':14});
    const room=rx-65;
    if(room>15) {
      for(const side of [-1,1]) {
        const a=cx+side*33,b=cx+side*(rx-33);
        line(orbit,a,cy,b,cy,{stroke:color('warning'),'stroke-width':2});
        node('path',{d:`M ${b-side*7} ${cy-4} L ${b} ${cy} L ${b-side*7} ${cy+4}`,fill:'none',stroke:color('warning'),'stroke-width':2},orbit);
      }
    }
    const positions=[[cx-rx,cy],[cx,cy+ry],[cx+rx,cy],[cx,cy-ry]];
    positions.forEach(([x,y],i)=>{
      const correctMark=review&&answered&&i===0;
      const wrongMark=review&&answered&&chosen!==0&&i===chosen;
      const markColor=correctMark?color('success'):wrongMark?color('danger'):(!review&&selected===i?color('accent'):'transparent');
      const g=node('g',{class:'planet',id:`position-${i}`,role:'button',tabindex:answered?-1:0,'aria-label': review&&!answered ? `位置${letters[i]}` : `${seasons[i]}，${dates[i]}${correctMark?'，正确答案':wrongMark?'，你的选择，错误':''}`,'aria-disabled':answered?'true':'false'},orbit);
      node('circle',{class:'halo',cx:x,cy:y,r:29,fill:'none',stroke:markColor,'stroke-width':correctMark||wrongMark?3:2,'stroke-dasharray':wrongMark?'5 4':'none'},g);
      node('circle',{cx:x,cy:y,r:22,fill:color('surface'),stroke:color('text-muted'),'stroke-width':1.5},g);
      line(g,x,y-38,x,y+35,{'stroke-dasharray':'3 3',stroke:color('border')});
      const dx=tilted?15:0,dy=tilted?34:37;
      line(g,x-dx,y+dy,x+dx,y-dy,{stroke:color('accent'),'stroke-width':2.5});
      node('circle',{cx:x+dx,cy:y-dy,r:2.7,fill:color('accent')},g);
      line(g,x-17,y-(tilted?7.5:0),x+17,y+(tilted?7.5:0),{stroke:color('text-muted')});
      text(g,x+dx+12,y-dy+5,'北',{'font-size':12,fill:color('accent')});
      const label=review&&!answered?`位置${letters[i]}`:seasons[i];
      const ly=i===3?13:i===1?307:y+55;
      text(g,x,ly,label,{'font-size':14,'font-weight':600,fill:correctMark?color('success'):wrongMark?color('danger'):!review&&selected===i?color('accent'):color('text')});
      if(!review||answered) text(g,x,ly+17,correctMark?'正确答案':wrongMark?'你的选择':dates[i],{'font-size':12,'font-weight':correctMark||wrongMark?600:400,fill:correctMark?color('success'):wrongMark?color('danger'):color('text-muted')});
      const act=()=>choose(i);
      g.addEventListener('click',act,{signal:ctx.signal});
      g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act();}},{signal:ctx.signal});
    });
  }
  function drawDetail() {
    const delta=tilted ? [23.5,0,-23.5,0][selected] : 0;
    const rad=delta*Math.PI/180, sx=-Math.cos(rad), sy=-Math.sin(rad), vx=-sy, vy=sx;
    const cx=198,cy=114,r=70;
    section.replaceChildren();
    text(section,12,18,'平行太阳光',{'text-anchor':'start',fill:color('warning')});
    node('circle',{cx,cy,r,fill:color('border'),stroke:color('text-muted')},section);
    const a=Math.atan2(sy,sx)-Math.PI/2, b=a+Math.PI;
    const p1=[cx+r*Math.cos(a),cy+r*Math.sin(a)],p2=[cx+r*Math.cos(b),cy+r*Math.sin(b)];
    node('path',{d:`M ${p1[0]} ${p1[1]} A ${r} ${r} 0 0 1 ${p2[0]} ${p2[1]} Z`,fill:color('warning'),'fill-opacity':0.3},section);
    for(const lat of [23.5,0,-23.5]){
      const rr=lat*Math.PI/180,yy=cy-r*Math.sin(rr),hh=r*Math.cos(rr);
      line(section,cx-hh,yy,cx+hh,yy,{stroke:color('text-muted'),'stroke-dasharray':lat?'3 3':'none','stroke-width':1});
      text(section,cx+18,yy-5,lat===0?'赤道':lat>0?'北回归线':'南回归线',{'font-size':12});
    }
    line(section,cx,cy-r-18,cx,cy+r+18,{stroke:color('accent'),'stroke-width':2});
    text(section,cx,cy-r-24,'北',{'font-size':12,fill:color('accent')});
    text(section,cx,cy+r+33,'南',{'font-size':12,fill:color('accent')});
    for(const off of [-34,0,34]) {
      const depth=Math.sqrt(r*r-off*off),ex=cx+sx*depth+vx*off,ey=cy+sy*depth+vy*off;
      const ax=ex+sx*78,ay=ey+sy*78;
      line(section,ax,ay,ex,ey,{stroke:color('warning'),'stroke-width':off===0?2.5:1.5});
      node('path',{d:`M ${ex+sx*8+vx*4} ${ey+sy*8+vy*4} L ${ex} ${ey} L ${ex+sx*8-vx*4} ${ey+sy*8-vy*4}`,fill:'none',stroke:color('warning'),'stroke-width':1.5},section);
    }
    node('circle',{cx:cx+sx*r,cy:cy+sy*r,r:5,fill:color('accent'),stroke:color('surface'),'stroke-width':2},section);
    text(section,150,239,'剖面以地轴为竖直参照；蓝点为直射点',{'font-size':12,fill:color('text-muted')});
    const hours=24/Math.PI*Math.acos(-Math.tan(40*Math.PI/180)*Math.tan(rad));
    q('.stat-title').textContent=tilted?`北半球 · ${seasons[selected]}`:'对照 · 地轴不倾斜';
    q('#latitude').textContent=delta===0?'赤道（0°）':`${delta>0?'北':'南'}纬约23.5°`;
    q('#altitude').textContent=`${(90-Math.abs(40-delta)).toFixed(1)}°`;
    q('.day').style.width=`${hours/24*100}%`;
    q('#day-label').textContent=`白昼 ${hours.toFixed(1)} 小时`;
    q('#night-label').textContent=`黑夜 ${(24-hours).toFixed(1)} 小时`;
    q('.takeaway').textContent=!tilted?'没有倾斜，直射点全年在赤道，不会产生由倾角引起的四季变化。':delta>0?'北半球朝向太阳：正午太阳更高、白昼更长。北半球为夏季，南半球相反。':delta<0?'北半球背向太阳：正午太阳较低、白昼较短。北半球为冬季，南半球相反。':'太阳直射赤道，全球昼夜约等长；南北半球的季节相反。';
  }
  function choose(i) {
    if(review){
      if(answered)return;
      answered=true;chosen=i;selected=0;
      const ok=i===0;
      const feedback=q('.feedback'); feedback.hidden=false;
      feedback.style.borderColor=color(ok?'success':'danger');
      feedback.textContent=`${ok?'回答正确。':'还不对。'}夏至在甲位置（左侧）：地轴北端朝向太阳，太阳直射北回归线，北半球白昼较长。`;
      q('.details').hidden=false;q('.note').hidden=false;
      q('.intro').textContent=ok?'绿色实线圈是正确答案，也是你的选择。四处地轴的指向始终相同。':'绿色实线圈是正确答案；红色虚线圈是你的误选位置。';
      drawOrbit();drawDetail();
      ctx.submitResult({outcome:ok?'correct':'incorrect',score:ok?1:0,detail:`选择位置${letters[i]}作为北半球夏至；正确为甲。`,response:{position:letters[i]}});
    }else{selected=i;drawOrbit();drawDetail();}
  }
  q('#tilt-toggle').addEventListener('click',()=>{
    tilted=!tilted;q('#tilt-toggle').setAttribute('aria-pressed',String(!tilted));
    q('#tilt-toggle').textContent=tilted?'对照：若地轴不倾斜':'恢复：地轴倾斜23.5°';
    q('#tilt-label').textContent=tilted?'地轴倾斜约23.5°，方向基本不变':'倾角为0°：再点击四个位置比较';
    drawOrbit();drawDetail();
  },{signal:ctx.signal});
  function resize(){const w=Math.max(288,q('.season-widget').clientWidth-32);if(w!==width){width=w;drawOrbit();}}
  resize();drawOrbit();if(!review)drawDetail();
  const observer=new ResizeObserver(resize);observer.observe(root);
  return ()=>observer.disconnect();
}