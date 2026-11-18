(() => {
  const NS = "http://www.w3.org/2000/svg";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }
  function set(node, attrs) {
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  }
  const f1 = (n) => n.toFixed(1);
  function arrowHead(x1, y1, x2, y2, size = 7) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const p = (da) => `${f1(x2 - size * Math.cos(a + da))},${f1(y2 - size * Math.sin(a + da))}`;
    return `${f1(x2)},${f1(y2)} ${p(0.45)} ${p(-0.45)}`;
  }
  function svgPoint(svg, evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  /* 1. 单位圆：sin 的导数为什么是 cos */
  function unitCircle() {
    const svg = $("viz-circle");
    const readout = $("circle-readout");
    if (!svg) return;
    const cx = 80, cy = 88, r = 58;
    const wx0 = 168, ww = 160; // sin 曲线区域
    const wx = (t) => wx0 + (t / (2 * Math.PI)) * ww;

    el("line", { x1: 14, y1: cy, x2: 146, y2: cy, class: "axis" }, svg);
    el("line", { x1: cx, y1: 22, x2: cx, y2: 154, class: "axis" }, svg);
    el("line", { x1: wx0, y1: cy, x2: wx0 + ww + 4, y2: cy, class: "axis" }, svg);
    el("circle", { cx, cy, r, class: "ring" }, svg);
    let d = "";
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * 2 * Math.PI;
      d += `${i ? "L" : "M"}${f1(wx(t))} ${f1(cy - r * Math.sin(t))}`;
    }
    el("path", { d, class: "wave" }, svg);
    el("text", { x: wx0 + ww, y: cy + 16, class: "lbl", "text-anchor": "end" }, svg).textContent = "θ";

    const link = el("line", { class: "link" }, svg);
    const radius = el("line", { class: "radius" }, svg);
    const cos = el("line", { class: "cos" }, svg);
    const sin = el("line", { class: "sin" }, svg);
    const vel = el("line", { class: "vel" }, svg);
    const velHead = el("polygon", { class: "vel-head" }, svg);
    const velY = el("line", { class: "vel-y" }, svg);
    const tangent = el("line", { class: "tangent" }, svg);
    const wdot = el("circle", { r: 4, class: "dot" }, svg);
    const dot = el("circle", { r: 6, class: "dot handle" }, svg);
    const hit = el("circle", { r: 18, class: "hit" }, svg);

    let theta = 0.9;
    function draw() {
      const s = Math.sin(theta), c = Math.cos(theta);
      const px = cx + r * c, py = cy - r * s;
      const L = 36;
      const vx = px - L * s, vy = py - L * c;
      const t = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const qx = wx(t), qy = cy - r * s;
      const k = (r * c) / (ww / (2 * Math.PI)); // 曲线斜率（像素）
      const h = 22 / Math.sqrt(1 + k * k);

      set(radius, { x1: cx, y1: cy, x2: px, y2: py });
      set(cos, { x1: cx, y1: cy, x2: px, y2: cy });
      set(sin, { x1: px, y1: cy, x2: px, y2: py });
      set(vel, { x1: px, y1: py, x2: vx, y2: vy });
      velHead.setAttribute("points", arrowHead(px, py, vx, vy));
      set(velY, { x1: vx, y1: py, x2: vx, y2: vy });
      set(link, { x1: px, y1: py, x2: qx, y2: qy });
      set(tangent, { x1: qx - h, y1: qy + k * h, x2: qx + h, y2: qy - k * h });
      set(wdot, { cx: qx, cy: qy });
      set(dot, { cx: px, cy: py });
      set(hit, { cx: px, cy: py });
      const deg = Math.round((t * 180) / Math.PI);
      readout.innerHTML =
        `θ = ${deg}°<span class="sep"></span><span class="t-sin">sin θ = ${s.toFixed(2)}</span>` +
        `<span class="sep"></span><span class="t-cos">变化率 = cos θ = ${c.toFixed(2)}</span>`;
    }

    let dragging = false, lastInput = 0;
    function setFromEvent(evt) {
      const p = svgPoint(svg, evt);
      if (p.x > wx0 - 6) {
        theta = Math.min(Math.max((p.x - wx0) / ww, 0), 1) * 2 * Math.PI;
      } else {
        theta = Math.atan2(cy - p.y, p.x - cx);
      }
      lastInput = performance.now();
      draw();
    }
    svg.addEventListener("pointerdown", (e) => {
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      setFromEvent(e);
    });
    svg.addEventListener("pointermove", (e) => dragging && setFromEvent(e));
    const stop = () => { dragging = false; lastInput = performance.now(); };
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);

    draw();
    if (reduceMotion) return;
    let prev = performance.now(), visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(svg);
    function tick(now) {
      const dt = Math.min((now - prev) / 1000, 0.1);
      prev = now;
      if (visible && !dragging && now - lastInput > 2500) {
        theta += dt * 0.6;
        draw();
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* 2. 遗忘曲线：FSRS 公式 R(t) = (1 + 19/81 · t/S)^-0.5 */
  function forgettingCurve() {
    const svg = $("viz-curve");
    const slider = $("review-slider");
    if (!svg || !slider) return;
    const X0 = 52, X1 = 584, Y0 = 26, Y1 = 206, DAYS = 120;
    const S0 = 3, GROWTH = 2.5, TARGET = 0.9; // 初始稳定性（天）和增长倍数为示意值
    const x = (t) => X0 + (t / DAYS) * (X1 - X0);
    const y = (R) => Y1 - R * (Y1 - Y0);
    const R = (t, S) => Math.pow(1 + (19 / 81) * (t / S), -0.5);

    for (const [v, label] of [[1, "100%"], [0.5, "50%"], [0, "0"]]) {
      el("line", { x1: X0, y1: y(v), x2: X1, y2: y(v), class: v === 0 ? "axis" : "grid" }, svg);
      el("text", { x: X0 - 8, y: y(v) + 4, class: "lbl", "text-anchor": "end" }, svg).textContent = label;
    }
    el("line", { x1: X0, y1: y(TARGET), x2: X1, y2: y(TARGET), class: "target" }, svg);
    el("text", { x: x(DAYS / 2), y: y(TARGET) + 15, class: "lbl accent", "text-anchor": "middle" }, svg).textContent = "降到 90% 时复习";
    for (let d = 0; d <= DAYS; d += 30) {
      el("text", { x: x(d), y: Y1 + 18, class: "lbl", "text-anchor": "middle" }, svg).textContent = d ? `${d} 天` : "0";
    }
    let base = "";
    for (let t = 0; t <= DAYS; t += 0.5) base += `${t ? "L" : "M"}${f1(x(t))} ${f1(y(R(t, S0)))}`;
    el("path", { d: base, class: "forget" }, svg);
    const forgetLbl = el("text", { x: X1 - 4, y: y(R(DAYS, S0)) - 8, class: "lbl", "text-anchor": "end" }, svg);
    forgetLbl.textContent = "不复习";
    const keep = el("path", { class: "keep" }, svg);
    const marks = el("g", { class: "marks" }, svg);

    function draw() {
      const n = Number(slider.value);
      $("review-count").textContent = n;
      let d = "", start = 0, S = S0;
      const reviews = [], intervals = [];
      for (let i = 0; i <= n; i++) {
        const end = i < n ? Math.min(start + S, DAYS) : DAYS;
        for (let t = start; t <= end + 1e-9; t += 0.5) {
          d += `${d ? "L" : "M"}${f1(x(t))} ${f1(y(R(t - start, S)))}`;
        }
        if (i < n && start + S <= DAYS) {
          intervals.push(S);
          reviews.push(start + S);
          d += `L${f1(x(start + S))} ${f1(y(1))}`;
          start += S;
          S *= GROWTH;
        } else if (i < n) break;
      }
      keep.setAttribute("d", d);
      marks.replaceChildren();
      for (const t of reviews) {
        el("circle", { cx: x(t), cy: y(1), r: 4 }, marks);
      }
      const nextS = S;
      intervals.push(nextS);
      $("curve-intervals").textContent = n === 0 ? "—" : intervals.map((v) => `${v < 10 ? v.toFixed(1).replace(".0", "") : Math.round(v)} 天`).join(" → ");
      const finalR = R(DAYS - start, S);
      const pctK = Math.round(finalR * 100), pct0 = Math.round(R(DAYS, S0) * 100);
      $("curve-recall").innerHTML = n === 0
        ? `<span class="accent-t">${pct0}%</span>`
        : `<span class="nw">复习 ${n} 次：<span class="accent-t">${pctK}%</span></span>　<span class="nw">不复习：${pct0}%</span>`;
    }
    slider.addEventListener("input", draw);
    draw();
  }

  /* 3a. 抛体运动 */
  function projectile() {
    const svg = $("viz-projectile");
    const slider = $("angle-slider");
    if (!svg || !slider) return;
    const ox = 18, gy = 150, Rmax = 264;
    el("line", { x1: 8, y1: gy, x2: 292, y2: gy, class: "axis" }, svg);
    const path45 = (deg) => {
      const a = (deg * Math.PI) / 180, R = Rmax * Math.sin(2 * a);
      let d = "";
      for (let i = 0; i <= 60; i++) {
        const xx = (i / 60) * R;
        const yy = xx * Math.tan(a) - (xx * xx) / (2 * Rmax * Math.cos(a) ** 2);
        d += `${i ? "L" : "M"}${f1(ox + xx)} ${f1(gy - yy)}`;
      }
      return d;
    };
    el("path", { d: path45(45), class: "ghost" }, svg);
    el("text", { x: ox + Rmax, y: gy + 15, class: "lbl", "text-anchor": "end" }, svg).textContent = "45°";
    const path = el("path", { class: "traj" }, svg);
    const land = el("circle", { r: 4, class: "dot" }, svg);
    const aim = el("line", { class: "aim" }, svg);

    function draw() {
      const deg = Number(slider.value), a = (deg * Math.PI) / 180;
      const ratio = Math.sin(2 * a);
      set(path, { d: path45(deg) });
      set(land, { cx: ox + Rmax * ratio, cy: gy });
      set(aim, { x1: ox, y1: gy, x2: ox + 34 * Math.cos(a), y2: gy - 34 * Math.sin(a) });
      $("angle-val").textContent = `${deg}°`;
      const twin = 90 - deg;
      $("projectile-note").textContent =
        deg === 45 ? "射程 = sin 2θ 的最大值，45° 最远。" : `射程是最远的 ${Math.round(ratio * 100)}%，和 ${twin}° 一样远。`;
    }
    slider.addEventListener("input", draw);
    draw();
  }

  /* 3b. 正态分布 */
  function normal() {
    const svg = $("viz-normal");
    const slider = $("sigma-slider");
    if (!svg || !slider) return;
    const X0 = 14, X1 = 286, base = 150, H = 120;
    const xs = (v) => X0 + ((v + 4) / 8) * (X1 - X0);
    const pdf = (v, s) => Math.exp(-(v * v) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));
    const ys = (p) => base - (p / 0.8) * H;
    el("line", { x1: X0, y1: base, x2: X1, y2: base, class: "axis" }, svg);
    const area = el("path", { class: "area" }, svg);
    const curve = el("path", { class: "traj" }, svg);
    const lblL = el("text", { class: "lbl", "text-anchor": "middle" }, svg);
    const lblR = el("text", { class: "lbl", "text-anchor": "middle" }, svg);
    const pct = el("text", { class: "lbl accent pct", "text-anchor": "middle" }, svg);

    function draw() {
      const s = Number(slider.value);
      let d = "", a = `M${f1(xs(-s))} ${base}`;
      for (let i = 0; i <= 120; i++) {
        const v = -4 + (i / 120) * 8;
        d += `${i ? "L" : "M"}${f1(xs(v))} ${f1(ys(pdf(v, s)))}`;
      }
      for (let i = 0; i <= 40; i++) {
        const v = -s + (i / 40) * 2 * s;
        a += `L${f1(xs(v))} ${f1(ys(pdf(v, s)))}`;
      }
      a += `L${f1(xs(s))} ${base}Z`;
      set(curve, { d });
      set(area, { d: a });
      set(lblL, { x: xs(-s), y: base + 15 });
      set(lblR, { x: xs(s), y: base + 15 });
      lblL.textContent = "−σ";
      lblR.textContent = "+σ";
      set(pct, { x: xs(0), y: Math.max(ys(pdf(0, s)) + (base - ys(pdf(0, s))) * 0.62, 40) });
      pct.textContent = "68.3%";
      $("sigma-val").textContent = s.toFixed(2).replace(/0$/, "");
    }
    slider.addEventListener("input", draw);
    draw();
  }

  /* 3c. 二分查找 */
  function binarySearch() {
    const box = $("viz-bsearch");
    if (!box) return;
    const arr = [3, 8, 12, 17, 21, 26, 30, 34, 41, 47, 52, 57, 63, 70, 76];
    const targets = [57, 12, 70, 30, 3, 47];
    let ti = 0, lo, hi, mid, steps, done, note;
    const cells = arr.map((v) => {
      const c = document.createElement("span");
      c.textContent = v;
      box.appendChild(c);
      return c;
    });
    const stepBtn = $("bs-step");

    function reset() {
      lo = 0; hi = arr.length - 1; mid = -1; steps = 0; done = false;
      note = `在 15 个有序数里找 <b>${targets[ti]}</b>。逐个找最多要 15 步。`;
      render();
    }
    function step() {
      if (done) return;
      const target = targets[ti];
      mid = Math.floor((lo + hi) / 2);
      steps++;
      const v = arr[mid];
      if (v === target) {
        done = true;
        note = `第 ${steps} 步找到 <b>${target}</b>。每步排除一半，15 个数最多 4 步。`;
      } else if (v < target) {
        note = `第 ${steps} 步：中间是 ${v} &lt; ${target}，排除左半边。`;
        lo = mid + 1;
      } else {
        note = `第 ${steps} 步：中间是 ${v} &gt; ${target}，排除右半边。`;
        hi = mid - 1;
      }
      render();
    }
    function render() {
      cells.forEach((c, i) => {
        c.className = "";
        if (i < lo || i > hi) c.classList.add("out");
        if (i === mid) c.classList.add(done ? "found" : "mid");
        if (arr[i] === targets[ti] && !done) c.classList.add("goal");
      });
      $("bs-note").innerHTML = note;
      stepBtn.disabled = done;
    }
    stepBtn.addEventListener("click", step);
    $("bs-reset").addEventListener("click", () => { ti = (ti + 1) % targets.length; reset(); });
    reset();
  }

  /* 4. 知识点掌握图 */
  function knowledgeMap() {
    const grid = $("viz-kmap");
    const legend = $("kmap-legend");
    if (!grid || !legend) return;
    const kinds = [
      { key: "known", label: "已掌握", n: 38 },
      { key: "fading", label: "快忘了", n: 12 },
      { key: "wrong", label: "总是错", n: 6 },
      { key: "new", label: "未学", n: 16 },
    ];
    const items = kinds.flatMap((k) => Array.from({ length: k.n }, () => k.key));
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    // 未学的放在最后，更像一副正在学的卡组
    items.sort((a, b) => (a === "new") - (b === "new"));
    for (const k of items) {
      const d = document.createElement("span");
      d.className = `k ${k}`;
      grid.appendChild(d);
    }
    for (const k of kinds) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="k ${k.key}"></span>${k.label} <b>${k.n}</b>`;
      li.tabIndex = 0;
      const on = () => grid.setAttribute("data-focus", k.key);
      const off = () => grid.removeAttribute("data-focus");
      li.addEventListener("mouseenter", on);
      li.addEventListener("focus", on);
      li.addEventListener("mouseleave", off);
      li.addEventListener("blur", off);
      legend.appendChild(li);
    }
  }

  unitCircle();
  forgettingCurve();
  projectile();
  normal();
  binarySearch();
  knowledgeMap();
})();
