import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function mount(root, ctx) {
  const review = ctx.mode === 'review';
  root.innerHTML = `<style>
    .methane{font-family:var(--wg-font-sans);color:var(--wg-color-text);padding:18px;box-sizing:border-box;max-width:900px;margin:auto}
    .methane *{box-sizing:border-box}.methane h2{font-size:20px;margin:0 0 8px}.methane p{margin:0;line-height:1.6;font-size:14px}
    .muted{color:var(--wg-color-text-muted)}.choices{display:flex;gap:10px;margin:16px 0 12px}.choices button{flex:1}
    .methane button,.methane select{font:inherit;font-size:14px;padding:10px 12px;border:1px solid var(--wg-color-border);border-radius:8px;color:var(--wg-color-text);background:var(--wg-color-surface);cursor:pointer}
    .methane button[aria-pressed=true]{border-color:var(--wg-color-accent);color:var(--wg-color-accent);background:var(--wg-color-background)}
    .methane button:focus-visible,.methane select:focus-visible{outline:2px solid var(--wg-color-accent);outline-offset:3px}.methane button:disabled{cursor:default;opacity:.65}
    .stage{height:360px;position:relative;border:1px solid var(--wg-color-border);border-radius:12px;overflow:hidden;background:var(--wg-color-background)}
    .stage canvas{display:block;width:100%;height:100%;touch-action:none}.atom{position:absolute;pointer-events:none;transform:translate(-50%,-50%);font-size:13px;font-weight:700;white-space:nowrap;line-height:1}
    .stage-note{position:absolute;bottom:10px;left:12px;right:12px;pointer-events:none;font-size:12px;color:var(--wg-color-text-muted)}
    .tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}.tools label{font-size:13px;display:flex;align-items:center;gap:6px}
    .readout{padding:14px;background:var(--wg-color-background);border-radius:10px;min-height:104px}.number{font-size:26px;color:var(--wg-color-accent);font-weight:650;margin:3px 0}.caption{font-size:13px;color:var(--wg-color-text-muted)}
    .methane .confirm{background:var(--wg-color-accent);color:var(--wg-color-on-accent);border-color:var(--wg-color-accent);width:100%;margin-top:12px}.feedback{margin-top:12px!important;min-height:44px}
    @media(max-width:440px){.methane{padding:12px}.stage{height:320px}.choices button{padding:10px 6px}}
  </style><section class="methane">
    <h2>${review ? '辨认甲烷的空间结构' : '甲烷：从平面到空间'}</h2>
    <p>${review ? '哪一个模型表示 CH₄ 的真实空间结构？切换并转动观察，再确认你的选择。' : '四对成键电子相互排斥，尽可能远离。四个氢原子在空间中怎样排布？'}</p>
    <div class="choices"><button id="model-a" type="button">${review ? '模型 A' : '平面十字形'}</button><button id="model-b" type="button">${review ? '模型 B' : '正四面体'}</button></div>
    <div class="stage" aria-label="可拖动旋转的甲烷候选球棍模型"><div class="stage-note">拖动旋转 · 球的大小仅作示意</div></div>
    <div class="tools"><button id="reset-view" type="button">重置视角</button><label><input id="show-edges" type="checkbox" ${review ? '' : 'checked'}>连接氢原子</label><label id="pair-control">测量<select id="pair" aria-label="选择两条键"><option value="0,1">H₁—C—H₂</option><option value="0,2">H₁—C—H₃</option><option value="0,3">H₁—C—H₄</option><option value="1,2">H₂—C—H₃</option><option value="1,3">H₂—C—H₄</option><option value="2,3">H₃—C—H₄</option></select></label></div>
    <div class="readout" aria-live="polite"></div>
    ${review ? '<button id="confirm" class="confirm" type="button">确认选择</button><p class="feedback" role="status"></p>' : ''}
  </section>`;
  const $ = s => root.querySelector(s);
  const stage = $('.stage');
  const renderer = new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38,1,.1,50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  function resetView(){camera.position.set(3.7,2.1,6.5);controls.target.set(0,0,0);controls.update();}
  resetView();
  scene.add(new THREE.HemisphereLight(0xffffff,0x667080,2.1));
  const light = new THREE.DirectionalLight(0xffffff,2.4);light.position.set(3,5,5);scene.add(light);
  const carbonMat = new THREE.MeshStandardMaterial({roughness:.48});
  const hydrogenMat = new THREE.MeshStandardMaterial({roughness:.5});
  const bondMat = new THREE.MeshStandardMaterial({roughness:.65});
  const selectedMat = new THREE.MeshStandardMaterial({roughness:.6});
  const edgeMat = new THREE.LineDashedMaterial({dashSize:.065,gapSize:.045,transparent:true,opacity:.65});
  const arcMat = new THREE.MeshBasicMaterial();
  const carbonGeo = new THREE.SphereGeometry(.25,24,16);
  const hydrogenGeo = new THREE.SphereGeometry(.185,24,16);
  const bondGeo = new THREE.CylinderGeometry(.042,.042,1,12);
  const carbon = new THREE.Mesh(carbonGeo,carbonMat);scene.add(carbon);
  const hydrogens=[], bonds=[], labels=[];
  const names=['C','H₁','H₂','H₃','H₄'];
  for(let i=0;i<5;i++){const el=document.createElement('span');el.className='atom';el.textContent=names[i];stage.append(el);labels.push(el);}
  for(let i=0;i<4;i++){const h=new THREE.Mesh(hydrogenGeo,hydrogenMat);scene.add(h);hydrogens.push(h);const b=new THREE.Mesh(bondGeo,bondMat);scene.add(b);bonds.push(b);}
  let edgeObject=null,arc=null;
  const length=1.5;
  const tetra=[new THREE.Vector3(0,1,0)];
  for(let i=0;i<3;i++){const a=(30+120*i)*Math.PI/180;tetra.push(new THREE.Vector3(Math.sqrt(8/9)*Math.cos(a),-1/3,Math.sqrt(8/9)*Math.sin(a)));}
  const flat=[new THREE.Vector3(0,1,0),new THREE.Vector3(1,0,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(-1,0,0)];
  let mode=review?'a':'b',answered=false,pair=[0,1],vectors=tetra;
  function revealed(){return !review || answered;}
  function rebuild(){
    vectors=mode==='b'?tetra:flat;
    $('#model-a').setAttribute('aria-pressed',String(mode==='a'));$('#model-b').setAttribute('aria-pressed',String(mode==='b'));
    vectors.forEach((v,i)=>{hydrogens[i].position.copy(v).multiplyScalar(length);const b=bonds[i];b.position.copy(v).multiplyScalar(length/2);b.scale.set(1,length,1);b.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v);b.material=revealed()&&pair.includes(i)?selectedMat:bondMat;});
    if(edgeObject){scene.remove(edgeObject);edgeObject.geometry.dispose();}
    const ep=[];for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){ep.push(vectors[i].clone().multiplyScalar(length),vectors[j].clone().multiplyScalar(length));}
    edgeObject=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ep),edgeMat);edgeObject.computeLineDistances();edgeObject.visible=$('#show-edges').checked;scene.add(edgeObject);
    if(arc){scene.remove(arc);arc.geometry.dispose();arc=null;}
    const u=vectors[pair[0]],v=vectors[pair[1]],angle=Math.acos(THREE.MathUtils.clamp(u.dot(v),-1,1));
    if(revealed()){
      let tangent=v.clone().addScaledVector(u,-u.dot(v));
      if(tangent.length()<.0001)tangent.set(-u.y,u.x,0);
      tangent.normalize();const pts=[];
      for(let i=0;i<=48;i++){const a=angle*i/48;pts.push(u.clone().multiplyScalar(Math.cos(a)*.58).addScaledVector(tangent,Math.sin(a)*.58));}
      arc=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),48,.012,6,false),arcMat);scene.add(arc);
    }
    $('#pair-control').hidden=!revealed();
    if(!revealed())$('.readout').innerHTML='<p>中心是碳原子 C，外侧是四个氢原子 H。</p><p class="muted">观察四条键的空间方向。结构名称与键角将在作答后揭示。</p>';
    else {
      const value=angle*180/Math.PI;
      $('.readout').innerHTML=`<div class="caption">${$('#pair').selectedOptions[0].textContent} · 绿色弧线所示夹角</div><div class="number">${value.toFixed(2)}°</div><p>${mode==='b'?'四个 H 位于正四面体顶点，C 在中心。任意两条键的夹角均约为 109.5°。':'平面十字形中，相邻键成 90°，相对键成 180°；它不是真实的空间形状。'}</p><div class="caption">${mode==='b'?'四条 C−H 单键等长，实际键长约 109 pm。':'平面结构式表示连接关系，不表示真实键角。'}</div>`;
    }
  }
  function applyTheme(){
    const c=ctx.theme.tokens.color;
    scene.background=new THREE.Color(c.background);
    carbonMat.color.set(c.accent);hydrogenMat.color.set(c.categorical[1]);bondMat.color.set(c.textMuted);selectedMat.color.set(c.success);edgeMat.color.set(c.textMuted);arcMat.color.set(c.success);
    labels[0].style.color=c.onAccent;
    for(let i=1;i<5;i++)labels[i].style.color='#17130e';
  }
  applyTheme();const unsubscribe=ctx.onThemeChange(applyTheme);
  const on=(el,type,fn)=>el.addEventListener(type,fn,{signal:ctx.signal});
  on($('#model-a'),'click',()=>{if(!answered){mode='a';rebuild();}});
  on($('#model-b'),'click',()=>{if(!answered){mode='b';rebuild();}});
  on($('#pair'),'change',()=>{pair=$('#pair').value.split(',').map(Number);rebuild();});
  on($('#show-edges'),'change',()=>{if(edgeObject)edgeObject.visible=$('#show-edges').checked;});
  on($('#reset-view'),'click',resetView);
  if(review)on($('#confirm'),'click',()=>{
    if(answered)return;answered=true;const choice=mode;const correct=choice==='b';
    mode='b';$('#show-edges').checked=true;pair=[0,1];$('#pair').value='0,1';resetView();rebuild();
    $('#model-a').disabled=true;$('#model-b').disabled=true;$('#confirm').disabled=true;$('#confirm').textContent='已提交';
    $('.feedback').style.color=correct?'var(--wg-color-success)':'var(--wg-color-danger)';
    $('.feedback').textContent=(correct?'答对了。':'还不正确。')+'真实结构是模型 B：四对成键电子尽可能远离，形成正四面体，而非平面十字形。';
    ctx.submitResult({outcome:correct?'correct':'incorrect',score:correct?1:0,detail:'选择模型 '+choice.toUpperCase()+'；正确模型为 B（正四面体）。',response:{choice,correctModel:'b'}});
  });
  function resize(){const w=stage.clientWidth,h=stage.clientHeight;if(w<=0||h<=0)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.fov=w<h?46:38;camera.updateProjectionMatrix();}
  const observer=new ResizeObserver(resize);observer.observe(stage);resize();rebuild();
  const projected=new THREE.Vector3(),towardCamera=new THREE.Vector3();
  let frame=0,disposed=false;
  function draw(){if(disposed)return;controls.update();renderer.render(scene,camera);
    const atoms=[carbon,...hydrogens];
    atoms.forEach((atom,i)=>{
      towardCamera.copy(camera.position).sub(atom.position).normalize().multiplyScalar(i===0?.265:.2);
      projected.copy(atom.position).add(towardCamera).project(camera);
      labels[i].style.left=((projected.x*.5+.5)*stage.clientWidth)+'px';labels[i].style.top=((-projected.y*.5+.5)*stage.clientHeight)+'px';
      const blocked=atoms.some((other,j)=>{if(i===j)return false;const delta=other.position.clone().sub(atom.position),dir=camera.position.clone().sub(atom.position).normalize();const d=delta.dot(dir);return d>0 && delta.addScaledVector(dir,-d).length()<(j===0?.24:.17);});
      labels[i].style.visibility=blocked?'hidden':'visible';
    });frame=requestAnimationFrame(draw);
  }
  draw();
  return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();unsubscribe();controls.dispose();carbonGeo.dispose();hydrogenGeo.dispose();bondGeo.dispose();if(edgeObject)edgeObject.geometry.dispose();if(arc)arc.geometry.dispose();[carbonMat,hydrogenMat,bondMat,selectedMat,edgeMat,arcMat].forEach(m=>m.dispose());renderer.dispose();};
}
