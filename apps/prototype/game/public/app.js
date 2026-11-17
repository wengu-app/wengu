// 温故游戏风原型：可交互版。排期用 scheduler.js（packages/core 的 FSRS + Anki 间隔规则），数据存在 localStorage。
'use strict';
const SCH = window.WenguScheduler;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DAY = 864e5, KEY = 'wengu-game-v1', LEARN_AHEAD = 20 * 60e3;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ======================= 内容 ======================= */
const DECKS = {
  geo: { name: '世界地理', ab: '地', c: 'var(--geo)', d: 'var(--geo-d)' },
  jp: { name: '日语 N2', ab: '日', c: 'var(--jp)', d: 'var(--jp-d)' },
  mcat: { name: 'MCAT', ab: 'M', c: 'var(--mcat)', d: 'var(--mcat-d)' },
  la: { name: '线性代数', ab: '∑', c: 'var(--la)', d: 'var(--la-d)' },
  his: { name: '中国历史', ab: '史', c: 'var(--his)', d: 'var(--his-d)' },
};
const EXTRA_COLORS = [['#e0812f', '#b8621a'], ['#2f9fd6', '#1f7aa8'], ['#5a9e3a', '#427a29'], ['#c95fbd', '#9c4692']];
const GEO = [
  ['东亚', '中国', '北京'], ['东亚', '日本', '东京'], ['东亚', '韩国', '首尔'], ['东亚', '朝鲜', '平壤'], ['东亚', '蒙古', '乌兰巴托', '全球年均气温最低的首都。'],
  ['东南亚', '越南', '河内'], ['东南亚', '泰国', '曼谷'], ['东南亚', '老挝', '万象', '位于湄公河左岸，与泰国隔河相望。'], ['东南亚', '柬埔寨', '金边', '洞里萨河与湄公河在此交汇。'],
  ['东南亚', '缅甸', '内比都', '2005 年从仰光迁都至此。'], ['东南亚', '马来西亚', '吉隆坡', '政府机构多已迁往布城。'], ['东南亚', '印度尼西亚', '雅加达', '正在建设的新首都是努山塔拉。'],
  ['东南亚', '菲律宾', '马尼拉'], ['东南亚', '文莱', '斯里巴加湾市'], ['东南亚', '东帝汶', '帝力'],
  ['南亚', '印度', '新德里'], ['南亚', '巴基斯坦', '伊斯兰堡'], ['南亚', '孟加拉国', '达卡'], ['南亚', '尼泊尔', '加德满都'], ['南亚', '不丹', '廷布'],
  ['南亚', '斯里兰卡', '科特（法定）· 科伦坡（商业）'], ['南亚', '马尔代夫', '马累'], ['南亚', '阿富汗', '喀布尔'],
  ['中亚', '哈萨克斯坦', '阿斯塔纳', '1997 年从阿拉木图迁都。'], ['中亚', '乌兹别克斯坦', '塔什干'], ['中亚', '吉尔吉斯斯坦', '比什凯克'], ['中亚', '塔吉克斯坦', '杜尚别'], ['中亚', '土库曼斯坦', '阿什哈巴德'],
  ['西亚', '伊朗', '德黑兰'], ['西亚', '伊拉克', '巴格达'], ['西亚', '沙特阿拉伯', '利雅得'], ['西亚', '土耳其', '安卡拉', '最大城市伊斯坦布尔不是首都。'], ['西亚', '约旦', '安曼'],
  ['西亚', '叙利亚', '大马士革'], ['西亚', '黎巴嫩', '贝鲁特'], ['西亚', '阿联酋', '阿布扎比'], ['西亚', '卡塔尔', '多哈'], ['西亚', '阿曼', '马斯喀特'], ['西亚', '科威特', '科威特城'], ['西亚', '也门', '萨那'],
  ['欧洲', '英国', '伦敦'],
  ['欧洲', '法国', '巴黎'],
  ['欧洲', '德国', '柏林'],
  ['欧洲', '意大利', '罗马'],
  ['欧洲', '西班牙', '马德里'],
  ['欧洲', '葡萄牙', '里斯本'],
  ['欧洲', '荷兰', '阿姆斯特丹', '政府所在地是海牙。'],
  ['欧洲', '比利时', '布鲁塞尔'],
  ['欧洲', '瑞士', '伯尔尼', '联邦政府所在地，宪法没有规定首都。'],
  ['欧洲', '奥地利', '维也纳'],
  ['欧洲', '波兰', '华沙'],
  ['欧洲', '捷克', '布拉格'],
  ['欧洲', '匈牙利', '布达佩斯'],
  ['欧洲', '希腊', '雅典'],
  ['欧洲', '瑞典', '斯德哥尔摩'],
  ['欧洲', '挪威', '奥斯陆'],
  ['欧洲', '芬兰', '赫尔辛基'],
  ['欧洲', '丹麦', '哥本哈根'],
  ['欧洲', '爱尔兰', '都柏林'],
  ['欧洲', '冰岛', '雷克雅未克', '世界最北的首都。'],
  ['欧洲', '罗马尼亚', '布加勒斯特'],
  ['欧洲', '保加利亚', '索非亚'],
  ['欧洲', '塞尔维亚', '贝尔格莱德'],
  ['欧洲', '克罗地亚', '萨格勒布'],
  ['欧洲', '乌克兰', '基辅'],
  ['欧洲', '俄罗斯', '莫斯科'],
  ['欧洲', '爱沙尼亚', '塔林'],
  ['欧洲', '拉脱维亚', '里加'],
  ['欧洲', '立陶宛', '维尔纽斯'],
  ['欧洲', '斯洛伐克', '布拉迪斯拉发'],
];
const JP = [
  ['懐かしい', 'なつかしい · 令人怀念的', '学生時代が懐かしい。<br>怀念学生时代。'], ['諦める', 'あきらめる · 放弃、死心', '最後まで諦めない。<br>坚持到最后。'],
  ['相変わらず', 'あいかわらず · 依旧、照旧'], ['面倒', 'めんどう · 麻烦'], ['曖昧', 'あいまい · 含糊、暧昧'], ['偶然', 'ぐうぜん · 偶然'], ['頼る', 'たよる · 依靠'],
  ['憧れる', 'あこがれる · 憧憬、向往'], ['戸惑う', 'とまどう · 困惑、不知所措'], ['勿体ない', 'もったいない · 可惜、浪费'], ['羨ましい', 'うらやましい · 羡慕'],
  ['眩しい', 'まぶしい · 耀眼、刺眼'], ['励ます', 'はげます · 鼓励'], ['慌てる', 'あわてる · 慌张'], ['険しい', 'けわしい · 险峻、严峻'], ['素直', 'すなお · 坦率、听话'],
  ['丁寧', 'ていねい · 礼貌、仔细'], ['我慢', 'がまん · 忍耐'], ['迷う', 'まよう · 迷路、犹豫'], ['怠ける', 'なまける · 偷懒'], ['呟く', 'つぶやく · 嘟囔、自言自语'],
  ['〜ばかりか', '不仅……而且', '彼は英語ばかりか、フランス語も話せる。<br>他不仅会英语，还会法语。', 1], ['〜に違いない', '一定是……', 'あの人は先生に違いない。<br>那个人一定是老师。', 1],
  ['〜わけにはいかない', '不能……（出于情理）', '約束したから、行かないわけにはいかない。<br>已经答应了，不能不去。', 1], ['〜おかげで', '多亏……', '先生のおかげで合格できた。<br>多亏老师，我考上了。', 1],
  ['〜せいで', '都怪……', '雨のせいで試合が中止になった。<br>都怪下雨，比赛取消了。', 1], ['〜てたまらない', '……得不得了', '会いたくてたまらない。<br>想见你想得不得了。', 1], ['〜に過ぎない', '只不过是……', 'それは噂に過ぎない。<br>那只不过是传言。', 1],
];
const MCAT = [
  ['生物化学', '米氏方程中，反应速度达到 V<sub>max</sub> 一半时的底物浓度称为 {{c1::K<sub>m</sub>（米氏常数）}}', 'K<sub>m</sub> 越小，酶与底物的亲和力越高。', 'cloze'],
  ['生物化学', '竞争性抑制剂对 K<sub>m</sub> 和 V<sub>max</sub> 的影响', 'K<sub>m</sub> 升高，V<sub>max</sub> 不变', '增加底物浓度可以抵消抑制。'],
  ['生物化学', '非竞争性抑制剂对 K<sub>m</sub> 和 V<sub>max</sub> 的影响', 'K<sub>m</sub> 不变，V<sub>max</sub> 降低'],
  ['生物化学', '糖酵解的限速酶', '磷酸果糖激酶-1（PFK-1）'], ['生物化学', '三羧酸循环发生的部位', '线粒体基质'], ['生物化学', '电子传递链的最终电子受体', 'O<sub>2</sub>'],
  ['生物化学', 'DNA 新链的合成方向', '5′ → 3′'], ['生物化学', '最常见的起始密码子', 'AUG（甲硫氨酸）'],
  ['生理学', '非选择性 β 受体阻滞剂的主要禁忌证', '哮喘、严重心动过缓', '阻断 β<sub>2</sub> 受体可诱发支气管痉挛。', 'leech'],
  ['生理学', '肾小球滤过率（GFR）最常用的临床估算指标', '血清肌酐（及其清除率）', '菊粉清除率最准确，但临床上少用。'],
  ['生理学', '抗利尿激素（ADH）的作用', '增加集合管对水的重吸收', '通过插入水通道蛋白 AQP2。'], ['生理学', '醛固酮的主要作用', '促进远曲小管和集合管重吸收 Na⁺、分泌 K⁺'],
  ['生理学', '胰岛素由哪种细胞分泌', '胰岛 β 细胞'], ['生理学', '心输出量的计算', '心率 × 每搏输出量'], ['生理学', '神经元动作电位的去极化主要由哪种离子内流引起', 'Na⁺'],
  ['生理学', '髓鞘的作用', '跳跃式传导，加快传导速度'], ['生理学', '触发突触前膜释放神经递质的离子', 'Ca²⁺'], ['生理学', '使氧解离曲线右移的因素', 'CO<sub>2</sub>↑、H⁺↑、温度↑、2,3-BPG↑'],
];
const LA = [
  ['方阵 A 可逆的充要条件（用行列式表示）', 'det A ≠ 0', '等价地：A 的列线性无关；Ax = 0 只有零解。'], ['秩–零化度定理', 'dim V = rank T + nullity T', 'T: V → W 为线性映射，V 有限维。'],
  ['方阵特征值之和等于', '矩阵的迹（对角元之和）'], ['方阵特征值之积等于', '行列式'], ['正交矩阵 Q 满足', 'Q<sup>T</sup>Q = I'], ['实对称矩阵的特征值', '全是实数', '并且可以正交对角化。'],
  ['相似矩阵一定相同的是', '特征多项式（从而特征值、迹、行列式）'], ['投影矩阵 P 满足', 'P² = P'], ['矩阵乘法满足交换律吗', '一般不满足：AB ≠ BA'],
  ['柯西–施瓦茨不等式', '|⟨u, v⟩| ≤ ‖u‖ ‖v‖'], ['向量组线性无关的定义', 'c₁v₁ + … + cₙvₙ = 0 只有零解'], ['n 阶方阵可对角化的充要条件', '有 n 个线性无关的特征向量'],
];
const HIS = [
  ['秦统一六国', '公元前 221 年'], ['唐朝建立', '618 年'], ['安史之乱爆发', '755 年'], ['北宋建立', '960 年'], ['王安石变法开始', '1069 年'],
  ['元朝定国号', '1271 年'], ['明朝建立', '1368 年'], ['郑和第一次下西洋', '1405 年'], ['清军入关', '1644 年'], ['辛亥革命', '1911 年'],
];

/* ======================= 时间与存储 ======================= */
let db;
const CONFIG = () => ({ learnSteps: [1, 10], relearnSteps: [10], maximumInterval: 36500, initialEase: 2.5, desiredRetention: db.dr, params: null, leechThreshold: 8, leechAction: 1, fuzz: true });
function dayStart(d) { const c = new Date(db.crt); return new Date(c.getFullYear(), c.getMonth(), c.getDate() + d, 4).getTime(); }
function dayOf(ms) { let d = Math.floor((ms - db.crt) / DAY); while (dayStart(d + 1) <= ms) d++; while (dayStart(d) > ms) d--; return d; }
const nowMs = () => Date.now() + db.offset * DAY;
function timeAt(ms) { const today = dayOf(ms); return { nowMs: ms, today, nextDayAtSecs: Math.floor(dayStart(today + 1) / 1000), dayStart }; }
const today = () => dayOf(nowMs());
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 存不下也能继续用 */ } }
function load() { try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.v === 1) return v; } catch (e) { } return null; }

/* ======================= 卡片与排期 ======================= */
const cols = c => ({ id: c.id, type: c.type, queue: c.queue, due: c.due, ivl: c.ivl, factor: c.factor, reps: c.reps, lapses: c.lapses, left: c.left, data: c.data });
function memOf(c) { const data = SCH.parseCardData(c.data); return { memory: SCH.memoryFromData(data), lastReviewSecs: typeof data.lrt === 'number' ? data.lrt : null }; }
function zh(label) {
  const m = /^([\d.]+)(s|m|h|d|mo|y)$/.exec(label); if (!m) return label;
  return m[1] + ' ' + { s: '秒', m: '分', h: '小时', d: '天', mo: '个月', y: '年' }[m[2]];
}
function preview(c, ms) { return SCH.previewCard(cols(c), memOf(c), CONFIG(), timeAt(ms), c.lastIvl || 0); }
function answer(c, rating, ms, secs) {
  const u = preview(c, ms)[rating - 1];
  if (c.type === 0) c.introDay = dayOf(ms);
  Object.assign(c, u.card);
  db.revlog.push({ id: ms, cid: c.id, ease: rating, ivl: u.revlog.ivl, lastIvl: u.revlog.lastIvl, kind: u.revlog.kind, time: Math.round(secs * 1000) });
  c.lastIvl = u.revlog.ivl;
  if (u.leech && !c.tags.includes('难点')) c.tags.push('难点');
  return u;
}
function retr(c, ms) {
  const m = memOf(c); if (!m.memory || m.lastReviewSecs == null) return null;
  const el = Math.max(0, dayOf(ms) - dayOf(m.lastReviewSecs * 1000));
  return SCH.retrievability(m.memory, el, null);
}
const deckOf = c => db.decks[c.deck];
const active = c => !c.susp && !deckOf(c).paused && c.buried !== today();
function isDueLearn(c, ms, ahead = 0) { return (c.queue === 1 && c.due * 1000 <= ms + ahead) || (c.queue === 3 && c.due <= dayOf(ms)); }
function isLearningToday(c, t) { return (c.queue === 1 && c.due < t.nextDayAtSecs) || (c.queue === 3 && c.due <= t.today); }
function isReviewDue(c, td) { return c.queue === 2 && c.due <= td; }
function newLimitLeft(deckId) {
  const td = today(), d = db.decks[deckId];
  const extra = db.extra.day === td ? db.extra.n : 0;
  const intro = db.cards.filter(c => c.deck === deckId && c.introDay === td).length;
  return Math.max(0, db.newPerDay + extra - intro);
}
function newCardsFor(deckId) { return db.cards.filter(c => c.deck === deckId && c.type === 0 && active(c)).sort((a, b) => a.due - b.due || a.id - b.id).slice(0, newLimitLeft(deckId)); }
function inScope(c, scope) { return scope === 'all' || scope === 'due' || c.deck === scope; }
function countsFor(scope) {
  const t = timeAt(nowMs());
  const cs = db.cards.filter(c => active(c) && inScope(c, scope));
  const r = cs.filter(c => isReviewDue(c, t.today)).length;
  const l = cs.filter(c => isLearningToday(c, t)).length;
  let n = 0;
  if (scope !== 'due') for (const id of Object.keys(db.decks)) if (!db.decks[id].paused && (scope === 'all' || scope === id)) n += newCardsFor(id).length;
  return { n, l, r };
}

/* ======================= 演示数据 ======================= */
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function seed() {
  const now = new Date();
  db = { v: 1, crt: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 220, 4).getTime(), offset: 0, dr: 0.9, newPerDay: 5, extra: { day: -1, n: 0 }, decks: {}, cards: [], revlog: [], nextId: 1700000000000 };
  for (const [k, v] of Object.entries(DECKS)) db.decks[k] = { name: v.name, ab: v.ab, c: v.c, d: v.d, paused: false };
  const mk = (deck, o) => { const id = db.nextId++; db.cards.push(Object.assign({ id, deck, kind: 'basic', front: '', back: '', extra: '', hint: '', tags: [], type: 0, queue: 0, due: db.cards.length, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, data: '', lastIvl: 0, flag: 0, susp: false }, o)); };
  GEO.forEach(([reg, c, a, x]) => mk('geo', { front: `${c}的首都`, back: a, extra: x || '', tags: [reg] }));
  JP.forEach(([w, a, x, g]) => mk('jp', { front: w, back: a, extra: x || '', hint: g ? '意思' : '读音和意思', tags: [g ? '语法' : '词汇'] }));
  MCAT.forEach(([sub, f, a, x, flag]) => {
    if (x === 'cloze') mk('mcat', { sub, kind: 'cloze', ord: 1, front: f, back: a, tags: [sub] });
    else mk('mcat', { sub, front: f, back: a, extra: x || '', tags: [sub], hard: flag === 'leech' });
  });
  LA.forEach(([f, a, x]) => mk('la', { front: f, back: a, extra: x || '', tags: ['矩阵'] }));
  HIS.forEach(([f, a]) => mk('his', { front: f, back: a, hint: '年份', tags: ['年代'] }));

  // 模拟过去的复习：每个卡组从某天开始学，每天学几张新卡，按记住概率随机答对答错
  const td = dayOf(Date.now()), R = rng(20261117);
  const plan = { geo: [150, 0, 10], jp: [84, 0, 8], mcat: [52, 0, 5], la: [38, 0, 3], his: [210, 64, 0] };
  const studied = new Set();
  for (let d = td - 215; d < td; d++) {
    if (d >= td - 3 || R() < (td - d < 30 ? 0.24 : 0.2)) continue; // 最近三天没复习，今天有积压
    let ms = dayStart(d) + (8 + R() * 12) * 3600e3;
    for (const [deck, [start, stopAgo, keepNew]] of Object.entries(plan)) {
      if (d < td - start || d >= td - stopAgo) continue;
      const cards = db.cards.filter(c => c.deck === deck);
      // 复习
      for (const c of cards.filter(c => (c.queue === 2 && c.due <= d) || (c.queue === 3 && c.due <= d))) {
        const r = retr(c, ms) ?? 0.9, pFail = c.hard ? 0.5 : (1 - r) * 0.9;
        simAnswer(c, R() < pFail ? 1 : R() < 0.12 ? 2 : R() < 0.93 ? 3 : 4);
      }
      // 新卡
      const fresh = cards.filter(c => c.type === 0), budget = fresh.length - keepNew;
      const perDay = Math.max(1, Math.ceil((cards.length - keepNew) / (start - stopAgo) * 1.6));
      for (const c of fresh.slice(0, Math.max(0, Math.min(perDay, budget)))) simAnswer(c, R() < 0.2 ? 1 : R() < 0.06 ? 4 : 3);
      // 当天的学习中卡片
      for (let k = 0; k < 4; k++) for (const c of cards.filter(c => c.queue === 1)) { ms = Math.max(ms, c.due * 1000 + 5e3); simAnswer(c, R() < 0.15 ? 1 : 3); }
    }
    studied.add(d);
    function simAnswer(c, g) { ms += (4 + R() * 9) * 1000; answer(c, g, ms, 4 + R() * 9); }
  }
  db.decks.his.paused = true;
  save();
}

/* ======================= 首页 ======================= */
const PLAY = '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>';
const CHECK = s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
const fmt = n => n.toLocaleString('en-US');
function deckStats(id) {
  const cs = db.cards.filter(c => c.deck === id), t = timeAt(nowMs());
  const mature = cs.filter(c => c.type === 2 && c.ivl >= 21).length, fresh = cs.filter(c => c.type === 0).length;
  const ids = new Set(cs.map(c => c.id)), since = nowMs() - 30 * DAY;
  const rv = db.revlog.filter(r => r.kind === 1 && r.id >= since && ids.has(r.cid));
  const last = db.revlog.filter(r => ids.has(r.cid)).reduce((a, r) => Math.max(a, r.id), 0);
  return { n: cs.length, mature, young: cs.length - mature - fresh, fresh, ret: rv.length ? Math.round(rv.filter(r => r.ease > 1).length / rv.length * 100) : null, last, t };
}
function ago(ms) {
  if (!ms) return '还没学过';
  const d = today() - dayOf(ms);
  return d <= 0 ? '今天' : d === 1 ? '昨天' : d < 30 ? `${d} 天前` : `${Math.round(d / 30)} 个月前`;
}
function renderHome() {
  const all = countsFor('all'), tot = all.n + all.l + all.r;
  const mins = Math.max(1, Math.round((all.n * 25 + all.l * 10 + all.r * 9) / 60));
  $('#hero').classList.toggle('clear', !tot);
  $('#totalDue').textContent = tot;
  $('#heroK').textContent = tot ? '今天要复习' : '今天的复习';
  $('#heroSub').textContent = tot ? `张卡，约 ${mins} 分钟` : '张，都复习完了';
  $('#heroPills').innerHTML = `<span class="pill ${all.n ? 'n' : 'z'}">${all.n} <em>新卡</em></span><span class="pill ${all.l ? 'l' : 'z'}">${all.l} <em>学习中</em></span><span class="pill ${all.r ? 'r' : 'z'}">${all.r} <em>到期</em></span>`;
  $('#heroActs').innerHTML = tot
    ? `<button class="btn lg" data-start="all">开始复习 <kbd>空格</kbd></button>${all.r && all.n ? '<button class="btn ghost lg" data-start="due">只复习到期</button>' : ''}`
    : `<button class="btn lg" id="learnMore">再学 10 张新卡</button><button class="btn ghost lg" data-nextday>跳到明天</button>`;
  const live = Object.keys(db.decks).filter(id => !db.decks[id].paused);
  $('#heroNote').innerHTML = tot ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>${live.length} 个卡组混在一起复习；想单独复习某个卡组，点下面的卡组。` : '明天会有新的卡到期。可以用右上角的"跳到明天"看看。';
  // 来自：每个卡组今天要复习多少
  const per = live.map(id => [id, countsFor(id)]).filter(([, c]) => c.n + c.l + c.r).sort((a, b) => (b[1].n + b[1].l + b[1].r) - (a[1].n + a[1].l + a[1].r));
  const td0 = n => `<td class="${n ? '' : 'z'}">${n}</td>`;
  $('#deckmix').innerHTML = per.length
    ? `<table class="mix"><thead><tr><th>来自</th><th>新卡</th><th>学习</th><th>到期</th><th>合计</th></tr></thead><tbody>${per.map(([id, c]) => `<tr data-start="${id}"><td><i style="background:${db.decks[id].c}"></i>${esc(db.decks[id].name)}</td>${td0(c.n)}${td0(c.l)}${td0(c.r)}<td class="tt">${c.n + c.l + c.r}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="5">点一行只复习那个卡组</td></tr></tfoot></table>`
    : '';

  // 卡组：后板 + 一摞卡 + 半高的前袋
  $('#deckSum').textContent = `${Object.keys(db.decks).length} 个 · ${fmt(db.cards.length)} 张`;
  $('#tiles').innerHTML = Object.entries(db.decks).map(([id, d]) => {
    const s = deckStats(id), c = countsFor(id), t = c.n + c.l + c.r;
    const pausedDue = d.paused ? db.cards.filter(x => x.deck === id && x.queue === 2 && x.due <= s.t.today).length : 0;
    const tot = Math.max(1, s.n);
    const layers = Math.max(2, Math.min(6, Math.round(Math.sqrt(s.n))));
    const r = rng(id.length * 31 + s.n);
    // 最上面那张卡显示接下来要复习的问题
    const mine = db.cards.filter(x => x.deck === id && !x.susp);
    const next = mine.filter(x => x.queue === 1 || x.queue === 3 || (x.queue === 2 && x.due <= s.t.today)).sort((p, q) => p.due - q.due)[0] || newCardsFor(id)[0] || mine.slice().sort((p, q) => (p.type === 2 ? p.due : 1e9) - (q.type === 2 ? q.due : 1e9))[0];
    const q = next ? esc(plain(next.kind === 'cloze' ? frontHtml(next, false) : next.front)) : '';
    const pile = [...Array(layers)].map((_, k) => { const top = k === layers - 1; return `<i style="--x:${top ? 0 : ((r() - .5) * 14).toFixed(1)}px;--y:${-(layers - 1 - k) * 5}px;--r:${top ? 0 : ((r() - .5) * 7).toFixed(1)}deg">${top && q ? `<span class="q">${q}</span>` : ''}</i>`; }).join('');
    return `<button class="pack${d.paused ? ' paused' : ''}" style="--c:${d.c};--d:${d.d}" data-start="${id}" aria-label="${esc(d.name)}">
      <span class="bk"></span>
      <span class="pile">${pile}</span>
      ${d.paused ? '<span class="due off" title="点击恢复">暂停</span>' : t ? `<span class="due" title="今天要复习">${t}</span>` : s.n ? `<span class="stamp">${CHECK(12)}今天完成</span>` : ''}
      <span class="front">
        <span class="hd"><span class="emb">${esc(d.ab)}</span><span style="min-width:0"><span class="pk-nm" style="display:block">${esc(d.name)}</span><span class="pk-n" style="display:block">${s.n} 张 · ${d.paused ? '已暂停' : '上次 ' + ago(s.last)}</span></span></span>
        <span class="label">
          <span class="lc">${t ? `<span class="pill ${c.n ? 'n' : 'z'}">${c.n}</span><span class="pill ${c.l ? 'l' : 'z'}">${c.l}</span><span class="pill ${c.r ? 'r' : 'z'}">${c.r}</span>` : d.paused ? `<span class="lt">${pausedDue} 张已过期 · 点击恢复</span>` : `<span class="lt ok">${s.n ? '没有待复习的卡' : '还没有卡片'}</span>`}<span class="ret" title="最近 30 天记住率">${s.ret == null ? '' : s.ret + '%'}</span></span>
          <span class="mbar" title="记牢 ${s.mature} · 在学 ${s.young} · 未学 ${s.fresh}"><i style="width:${s.mature / tot * 100}%;background:${d.c}"></i><i style="width:${s.young / tot * 100}%;background:color-mix(in srgb,${d.c} 40%,var(--surf))"></i></span>
        </span>
      </span>
    </button>`;
  }).join('');

  renderRecord(); renderForecast(); renderMemory();
  $('#demoDay').textContent = db.offset ? `第 ${db.offset} 天后` : '今天';
}
function renderRecord() {
  const td = today(), counts = new Map(), times = new Map();
  for (const r of db.revlog) { const d = dayOf(r.id); counts.set(d, (counts.get(d) || 0) + 1); times.set(d, (times.get(d) || 0) + r.time); }
  const days30 = [...Array(30)].map((_, i) => td - i).filter(d => counts.get(d)).length;
  const studied = [...times.entries()].filter(([d]) => d > td - 30);
  const avg = studied.length ? Math.round(studied.reduce((a, [, t]) => a + t, 0) / studied.length / 60000) : 0;
  $('#recBig').innerHTML = `<div><b>${days30}<small>/30</small></b><span>过去 30 天复习的天数</span></div><div><b>${counts.get(td) || 0}<small>张</small></b><span>今天已复习</span></div><div><b>${avg}<small>分</small></b><span>复习日平均用时</span></div>`;
  // 26 周，每列一周（周一开始），最后一列包含今天；复习越多，按键凸得越高
  const wd = (new Date(dayStart(td)).getDay() + 6) % 7, start = td - wd - 25 * 7;
  let html = '';
  for (let d = start; d < start + 26 * 7; d++) {
    if (d > td) { html += '<i class="f"></i>'; continue; }
    const n = counts.get(d) || 0, v = !n ? 0 : n < 6 ? 1 : n < 14 ? 2 : 3;
    const date = new Date(dayStart(d));
    html += `<i class="l${v}${d === td ? ' t' : ''}" title="${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${n} 张"></i>`;
  }
  $('#heat').innerHTML = html;
}
// 未来两周：每天一根立方体柱，一层一张卡
function renderForecast() {
  const td = today(), wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const cs = db.cards.filter(c => !c.susp && !deckOf(c).paused);
  const all = countsFor('all');
  // 演示卡组太小，未来几天只有一两张，图上补一份看起来像真实卡组的到期量（按日期固定，不随刷新变化）
  const fake = d => { const r = rng(d * 9973); return Math.round(24 + 9 * Math.sin(d * 0.9) + (d % 7 === 0 ? 10 : 0) + r() * 12); };
  const v = [...Array(14)].map((_, i) => i === 0 ? [all.n, all.l, all.r] : [0, i === 1 ? cs.filter(c => c.queue === 1 || (c.queue === 3 && c.due === td + 1)).length + 4 : 0, cs.filter(c => c.queue === 2 && c.due === td + i).length + fake(td + i)]);
  const W = 660, H = 300, base = 246, slot = W / 15.8, w = 24, dx = 9, dy = -7, maxH = 190;
  // 层厚按未来几天定，今天积压太高时整体压缩并画断口
  const maxF = Math.max(6, ...v.slice(1).map(x => x[0] + x[1] + x[2]));
  const unit = Math.min(8, maxH / maxF);
  const K = { n: 'new', l: 'lrn', r: 'rev' };
  const shade = (c, f, k) => { const col = f ? `color-mix(in srgb,var(--${c}) 55%,var(--surf))` : `var(--${c})`; return k === 'side' ? `color-mix(in srgb,${col} 72%,#000)` : k === 'top' ? `color-mix(in srgb,${col} 65%,#fff)` : col; };
  let g = '';
  v.forEach((x, i) => {
    // 今天占两格：左边是柱子，右边写各部分的数量
    const x0 = i ? slot * (i + 1.8) + (slot - w - dx) / 2 : (slot - w - dx) / 2 + 4, f = i ? 'f' : '', tot = x[0] + x[1] + x[2];
    const segs = [];
    let y = base, out = `<path d="M${x0 - 3},${base + 2} h${w + 6} l${dx},${dy} h${-(w + 6)} z" fill="#000" opacity=".06"/>`;
    const scale = tot * unit > maxH ? maxH / (tot * unit) : 1, cut = scale < 1;
    let top = null;
    if (!tot) { out += `<path d="M${x0},${base - 3} h${w} l${dx},${dy} h${-w} z" style="fill:var(--sunk);stroke:var(--line-d)" stroke-width="1"/><rect x="${x0}" y="${base - 3}" width="${w}" height="3" style="fill:var(--off)"/>`; }
    for (const [k, idx] of [['r', 2], ['l', 1], ['n', 0]]) {
      const n = x[idx]; if (!n) continue;
      const h = n * unit * scale, yt = y - h, c = K[k];
      out += `<rect x="${x0}" y="${yt}" width="${w}" height="${h}" style="fill:${shade(c, f)}"/><path d="M${x0 + w},${y} l${dx},${dy} V${yt + dy} l${-dx},${-dy} z" style="fill:${shade(c, f, 'side')}"/>`;
      if (!cut && unit >= 4) for (let j = 1; j < n; j++) { const yy = y - j * unit; out += `<path d="M${x0},${yy} h${w} l${dx},${dy}" fill="none" style="stroke:${shade(c, f, 'side')}" stroke-width="1" opacity=".35"/>`; }
      segs.push([k, n, yt, h]); y = yt; top = c;
    }
    if (top) {
      if (cut) { const yb = base - maxH * .55; out += `<path d="M${x0 - 2},${yb + 3} l5,-4 l5,4 l5,-4 l5,4 l5,-4 l5,4 l5,-4 v-6 l-5,4 l-5,-4 l-5,4 l-5,-4 l-5,4 l-5,-4 l-5,4 z" style="fill:var(--surf)"/>`; }
      out += `<path d="M${x0},${y} h${w} l${dx},${dy} h${-w} z" style="fill:${shade(top, f, 'top')}"/>`;
    }
    const cx = x0 + (w + dx) / 2, label = i === 0 ? '今天' : i === 1 ? '明天' : wk[new Date(dayStart(td + i)).getDay()];
    const date = new Date(dayStart(td + i)), md = `${date.getMonth() + 1}/${date.getDate()}`;
    if (i === 0) {
      if (tot) {
        const by = y + dy - 12, bw = String(tot).length * 9 + 30;
        out += `<rect x="${cx - bw / 2}" y="${by - 22}" width="${bw}" height="24" rx="8" style="fill:var(--ink)"/><path d="M${cx - 5},${by + 2} l5,5 l5,-5 z" style="fill:var(--ink)"/><text x="${cx}" y="${by - 5}" class="cy-b">${tot}<tspan class="u" dx="2">张</tspan></text>`;
        const NM = { n: '新卡', l: '学习', r: '到期' };
        for (const [k, n, yt, h] of segs) if (h >= 14) {
          const ym = yt + h / 2 + dy / 2, lx = x0 + w + dx + 6;
          out += `<path d="M${lx},${ym} h7" style="stroke:var(--${K[k]})" stroke-width="2" stroke-linecap="round"/><text x="${lx + 11}" y="${ym + 4.5}" class="cy-s" style="fill:var(--${K[k]})">${n}<tspan class="u" dx="3">${NM[k]}</tspan></text>`;
        }
      }
      out += `<rect x="${cx - 22}" y="${base + 12}" width="44" height="22" rx="8" style="fill:var(--ink)"/><text x="${cx}" y="${base + 27}" class="cy-d t">${label}</text><text x="${cx}" y="${base + 46}" class="cy-dt">${md}</text>`;
    } else {
      if (tot) out += `<text x="${cx}" y="${y + dy - 7}" class="cy-n">${tot}</text>`;
      out += `<text x="${cx}" y="${base + 27}" class="cy-d">${label}</text><text x="${cx}" y="${base + 46}" class="cy-dt">${md}</text>`;
    }
    g += `<g class="cy${i ? '' : ' today'}"><title>${label} · ${tot} 张</title>${out}</g>`;
  });
  $('#fcBars').innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="cyl">${g}</svg>`;
  $('#fcX').innerHTML = `<span><i style="background:var(--new)"></i>新卡</span><span><i style="background:var(--lrn)"></i>学习中</span><span><i style="background:var(--rev)"></i>到期</span><span class="m">一层 = 一张卡${(v[0][0] + v[0][1] + v[0][2]) * unit > maxH ? '；今天的太高，中间截断了' : ''}</span>`;
}
function renderMemory() {
  const since = nowMs() - 30 * DAY, rv = db.revlog.filter(r => r.kind === 1 && r.id >= since);
  const ret = rv.length ? Math.round(rv.filter(r => r.ease > 1).length / rv.length * 100) : null;
  const mature = db.cards.filter(c => c.type === 2 && c.ivl >= 21).length;
  const gained = db.revlog.filter(r => r.id >= since && r.lastIvl < 21 && r.ivl >= 21).length;
  const stabs = db.cards.filter(c => c.type === 2).map(c => memOf(c).memory?.stability).filter(Boolean).sort((a, b) => a - b);
  const med = stabs.length ? stabs[stabs.length >> 1] : 0;
  const goal = Math.round(db.dr * 100);
  // 仪表：70%–100% 映射到半圆
  const ang = p => Math.PI * (1 - Math.min(1, Math.max(0, (p - 70) / 30)));
  const pt = (p, r) => [60 + r * Math.cos(ang(p)), 62 - r * Math.sin(ang(p))];
  const arc = (p0, p1, r) => { const [x0, y0] = pt(p0, r), [x1, y1] = pt(p1, r); return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
  const ok = ret != null && ret >= goal - 2, gc = ret == null ? 'var(--ink-4)' : ok ? 'var(--rev)' : 'var(--lrn)';
  const [nx, ny] = pt(ret ?? 70, 36), [tx0, ty0] = pt(goal, 40), [tx1, ty1] = pt(goal, 56);
  const gauge = `<svg viewBox="0 0 120 72" class="gauge2"><path d="${arc(70, 100, 48)}" fill="none" style="stroke:var(--off)" stroke-width="14" stroke-linecap="round"/>${ret != null ? `<path d="${arc(70, Math.max(70.5, ret), 48)}" fill="none" style="stroke:${gc}" stroke-width="14" stroke-linecap="round"/>` : ''}<line x1="${tx0}" y1="${ty0}" x2="${tx1}" y2="${ty1}" style="stroke:var(--ink)" stroke-width="3" stroke-linecap="round"/><line x1="60" y1="62" x2="${nx}" y2="${ny}" style="stroke:var(--ink)" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="62" r="7" style="fill:var(--ink)"/><circle cx="60" cy="62" r="2.5" style="fill:var(--surf)"/></svg>`;
  // 罐子：记牢的卡占全部卡的比例
  const frac = db.cards.length ? mature / db.cards.length : 0, lvl = 90 - frac * 70;
  const jar = `<svg viewBox="0 0 80 100" class="jar"><defs><clipPath id="jarc"><path d="M14 22h52v62a10 10 0 0 1-10 10H24a10 10 0 0 1-10-10z"/></clipPath></defs><rect x="10" y="8" width="60" height="14" rx="5" style="fill:var(--his)"/><rect x="10" y="17" width="60" height="5" style="fill:var(--his-d)"/><g clip-path="url(#jarc)"><rect x="0" y="0" width="80" height="100" style="fill:var(--sunk)"/><path class="wave" d="M-40 ${lvl} q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V100 H-40z" style="fill:var(--rev)"/><path class="wave w2" d="M-40 ${lvl + 3} q10 -4 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V100 H-40z" style="fill:var(--rev-d)" opacity=".5"/></g><path d="M14 22h52v62a10 10 0 0 1-10 10H24a10 10 0 0 1-10-10z" fill="none" style="stroke:var(--line-d)" stroke-width="3"/><rect x="20" y="30" width="5" height="40" rx="2.5" fill="#fff" opacity=".5"/></svg>`;
  // 刻度尺：对数刻度上标出记忆稳定性中位数
  const L = d => Math.min(100, Math.log(Math.max(1, d)) / Math.log(365) * 100);
  const ticks = [[1, '1天'], [7, '1周'], [30, '1月'], [365, '1年']];
  const ruler = `<div class="ruler"><div class="rl-bar"><i style="width:${L(med)}%"></i></div>${ticks.map(([d, t]) => `<span class="tk" style="left:${L(d)}%">${t}</span>`).join('')}<span class="pin" style="left:${L(med)}%"></span></div>`;
  const medTxt = med >= 60 ? Math.round(med / 30) + '<small>个月</small>' : Math.round(med) + '<small>天</small>';
  // 秒表：最近 30 天每张卡的平均作答时间
  const rl30 = db.revlog.filter(r => r.id >= since), avgS = rl30.length ? rl30.reduce((a, r) => a + r.time, 0) / rl30.length / 1000 : 0;
  const ha = Math.min(60, avgS) / 60 * 2 * Math.PI, hx = 40 + 22 * Math.sin(ha), hy = 52 - 22 * Math.cos(ha);
  const watch = `<svg viewBox="0 0 80 90" class="watch"><rect x="33" y="2" width="14" height="9" rx="3" style="fill:var(--ink-3)"/><rect x="58" y="12" width="9" height="7" rx="2" transform="rotate(40 62 15)" style="fill:var(--ink-4)"/><circle cx="40" cy="52" r="34" style="fill:var(--surf);stroke:var(--ink)" stroke-width="5"/>${[...Array(12)].map((_, k) => { const a = k / 12 * 2 * Math.PI; return `<line x1="${40 + 25 * Math.sin(a)}" y1="${52 - 25 * Math.cos(a)}" x2="${40 + 29 * Math.sin(a)}" y2="${52 - 29 * Math.cos(a)}" style="stroke:var(--ink-4)" stroke-width="${k % 3 ? 1.5 : 3}" stroke-linecap="round"/>`; }).join('')}<path d="M40 52 L40 ${52 - 22} A22 22 0 ${ha > Math.PI ? 1 : 0} 1 ${hx} ${hy} Z" style="fill:var(--new)" opacity=".18"/><line x1="40" y1="52" x2="${hx}" y2="${hy}" style="stroke:var(--new)" stroke-width="4" stroke-linecap="round"/><circle cx="40" cy="52" r="4.5" style="fill:var(--ink)"/></svg>`;
  $('#mem').innerHTML = `<div class="blk-h"><h2>记忆状况</h2></div>
    <div class="m m-g"><div class="l">实际记住率</div>${gauge}<div class="v c">${ret ?? '—'}<small>%</small></div><div class="d c">最近 30 天 · 目标 ${goal}%${ret != null ? (ok ? ' · <b>达标</b>' : ' · <b style="color:var(--lrn)">偏低</b>') : ''}</div></div>
    <div class="m m-j">${jar}<div><div class="l">已经记牢</div><div class="v">${fmt(mature)}</div><div class="d">占全部 ${Math.round(frac * 100)}%<br>本月 <b>+${gained}</b></div></div></div>
    <div class="m m-r"><div class="l">一般能记住</div><div class="v">${medTxt}</div>${ruler}<div class="d">记忆稳定性的中位数</div></div>
    <div class="m m-w">${watch}<div><div class="l">每张用时</div><div class="v">${avgS ? avgS.toFixed(1) : '—'}<small>秒</small></div><div class="d">近 30 天平均<br>共答 ${fmt(rl30.length)} 次</div></div></div>`;
}

/* ======================= 复习 ======================= */
let sess = null, shown = false, sideOn = true;
function startReview(scope) {
  const t = timeAt(nowMs());
  const pool = db.cards.filter(c => active(c) && inScope(c, scope));
  const rand = rng(t.today * 7 + 1);
  const reviews = pool.filter(c => isReviewDue(c, t.today) || (c.queue === 3 && c.due <= t.today)).map(c => [rand(), c]).sort((a, b) => a[0] - b[0]).map(x => x[1].id);
  let news = [];
  if (scope !== 'due') for (const id of Object.keys(db.decks)) if (!db.decks[id].paused && (scope === 'all' || scope === id)) news.push(...newCardsFor(id).map(c => c.id));
  const main = [], gap = news.length ? Math.max(1, Math.floor(reviews.length / news.length)) : 0;
  let ri = 0;
  for (const nid of news) { for (let k = 0; k < gap && ri < reviews.length; k++) main.push(reviews[ri++]); main.push(nid); }
  while (ri < reviews.length) main.push(reviews[ri++]);
  const total = main.length + pool.filter(c => isLearningToday(c, t) && c.queue === 1).length;
  if (!total) return toast('这里今天没有要复习的卡');
  sess = { scope, main, log: [], undo: [], t0: Date.now(), cur: null, total, done: 0 };
  $('#rvDeck').innerHTML = db.decks[scope] ? `<i style="background:${db.decks[scope].c}"></i>${esc(db.decks[scope].name)}` : scope === 'due' ? '只复习到期' : '全部卡组';
  $('#rv').classList.remove('finished'); $('#rv').classList.toggle('noside', !sideOn); $('#rv').classList.add('on');
  document.documentElement.style.overflow = 'hidden';
  nextCard();
}
function exitReview() { $('#rv').classList.remove('on'); document.documentElement.style.overflow = ''; sess = null; renderHome(); if ($('#browse').classList.contains('on')) renderBrowse(); }
const byId = id => db.cards.find(c => c.id === id);
function pickNext() {
  const ms = nowMs(), td = dayOf(ms);
  const learn = db.cards.filter(c => active(c) && inScope(c, sess.scope) && c.queue === 1).sort((a, b) => a.due - b.due);
  if (learn[0] && learn[0].due * 1000 <= ms) return learn[0];
  while (sess.main.length) {
    const c = byId(sess.main[0]);
    if (c && active(c) && (c.type === 0 || isReviewDue(c, td) || (c.queue === 3 && c.due <= td))) return c;
    sess.main.shift();
  }
  if (learn[0] && learn[0].due * 1000 <= ms + LEARN_AHEAD) return learn[0];
  return null;
}
function nextCard() {
  const c = pickNext();
  if (!c) return finish();
  sess.cur = c.id; sess.shownAt = Date.now(); shown = false;
  sess.prev = preview(c, nowMs()).map(u => zh(u.outcome.label));
  render(c);
}
function stateOf(c) { return c.type === 0 ? 'n' : c.queue === 1 || c.queue === 3 ? 'l' : 'r'; }
function frontHtml(c, reveal) {
  if (c.kind === 'cloze') return c.front.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g, (_, n, a, h) => +n === c.ord ? `<span class="cloze${reveal ? ' on' : ''}">${reveal ? a : `［${h || '…'}］`}</span>` : a);
  return c.front;
}
function render(c) {
  const q = $('#qcard'); q.classList.remove('in'); void q.offsetWidth; q.classList.add('in');
  const d = deckOf(c), st = stateOf(c);
  q.style.setProperty('--c', d.c); q.style.setProperty('--d', d.d);
  $('#tags').innerHTML = `<span class="tag" style="--c:${d.c}">${esc(d.name)}${c.sub ? ' · ' + c.sub : ''}</span>` +
    ({ n: '<span class="tag" style="--c:var(--new)">新卡</span>', l: `<span class="tag" style="--c:var(--lrn)">${c.type === 3 ? '重新学习' : '学习中'}</span>`, r: '' })[st] +
    (c.tags.includes('难点') ? `<span class="tag" style="--c:var(--lrn)">难点 · 忘了 ${c.lapses} 次</span>` : '');
  $('#front').innerHTML = frontHtml(c, false); $('#hint').textContent = c.hint || '';
  $('#ans').innerHTML = c.kind === 'cloze' ? '' : c.back; $('#ans').style.display = c.kind === 'cloze' ? 'none' : '';
  $('#extra').innerHTML = c.kind === 'cloze' ? c.back : c.extra;
  $('#back').classList.remove('on'); $('#flag').classList.toggle('on', !!c.flag);
  sess.prev.forEach((v, k) => $('#i' + (k + 1)).textContent = v);
  $('#showBtn').classList.remove('off'); $('#grades').classList.remove('on');
  updateCounts(c); renderSide(c);
  const left = sess.main.length + db.cards.filter(x => active(x) && inScope(x, sess.scope) && x.queue === 1).length;
  $('#qcard').dataset.stack = Math.min(3, Math.max(0, left - 1));
}
function updateCounts(c) {
  const t = timeAt(nowMs()), cs = db.cards.filter(x => active(x) && inScope(x, sess.scope));
  const inMain = new Set(sess.main);
  const n = cs.filter(x => x.type === 0 && inMain.has(x.id)).length;
  const r = cs.filter(x => x.queue === 2 && inMain.has(x.id) && x.due <= t.today).length;
  const l = cs.filter(x => isLearningToday(x, t)).length;
  $('#cN').textContent = n; $('#cL').textContent = l; $('#cR').textContent = r;
  $$('.qcnt .pill').forEach(p => p.classList.remove('cur'));
  if (c) $({ n: '#cN', l: '#cL', r: '#cR' }[stateOf(c)]).classList.add('cur');
  const left = n + l + r;
  $('#prog').style.width = Math.min(100, sess.done / Math.max(1, sess.done + left) * 100) + '%';
}
function renderSide(c) {
  const ms = nowMs(), m = memOf(c), R = retr(c, ms), circ = 2 * Math.PI * 38;
  const pct = R == null ? null : Math.round(R * 100);
  const col = pct == null ? 'var(--new)' : pct < 80 ? 'var(--lrn)' : pct < 90 ? 'var(--hard)' : 'var(--rev)';
  const gcol = g => ['', 'var(--lrn)', 'var(--hard)', 'var(--rev)', 'var(--new)'][g];
  const hist = db.revlog.filter(r => r.cid === c.id);
  const S = m.memory?.stability, D = m.memory?.difficulty;
  const elapsed = m.lastReviewSecs != null ? Math.max(0, today() - dayOf(m.lastReviewSecs * 1000)) : 0;
  let curve = '';
  if (S) {
    const span = Math.max(elapsed * 1.6, c.ivl * 1.3, 3), y = r => 8 + (1 - r) / .4 * 68, pts = [];
    for (let x = 0; x <= 60; x++) pts.push(`${(x / 60 * 292).toFixed(1)},${y(SCH.retrievability(m.memory, x / 60 * span, null)).toFixed(1)}`);
    const line = pts.join(' ');
    curve = `<div><h3 style="margin-bottom:8px">遗忘曲线 <span style="letter-spacing:0;font-weight:600">虚线 = 目标 ${Math.round(db.dr * 100)}%</span></h3><svg class="curve" viewBox="0 0 292 84" preserveAspectRatio="none"><line x1="0" x2="292" y1="${y(db.dr)}" y2="${y(db.dr)}" stroke="var(--line-d)" stroke-width="2" stroke-dasharray="4 4"/><polygon points="${line} 292,84 0,84" fill="${col}" opacity=".12"/><polyline points="${line}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round"/><circle cx="${Math.min(elapsed / span * 292, 286)}" cy="${y(R)}" r="5" fill="${col}" stroke="var(--surf)" stroke-width="2"/></svg></div>`;
  }
  const deck = deckOf(c), st = stateOf(c);
  let why;
  if (st === 'n') { const k = db.cards.filter(x => x.deck === c.deck && x.introDay === today()).length + 1; why = `这是一张<b>新卡</b>。${esc(deck.name)}每天学 ${db.newPerDay} 张新卡，这是今天的第 ${k} 张。`; }
  else if (c.type === 3) why = `刚才<b>忘了</b>，正在重新学习，再答对一次就回到正常间隔。`;
  else if (st === 'l') why = `正在学习：第一次学会后，${c.left <= 1 ? '再答对一次就进入以天为单位的间隔' : '还要在几分钟后巩固一次'}。`;
  else why = `上次是 <b>${elapsed} 天前</b>，现在想起它的概率约 ${pct}%，${pct < db.dr * 100 ? `低于目标 ${Math.round(db.dr * 100)}%，所以今天出现` : '接近目标，今天正好复习'}。`;
  if (c.tags.includes('难点')) why += `<br><b class="hot">已经忘了 ${c.lapses} 次</b>，可以按 E 改写，或拆成更小的卡。`;
  $('#side').innerHTML = `
    <h3>这张卡 <span style="letter-spacing:0;font-weight:600">按 <kbd>I</kbd> 收起</span></h3>
    <div class="gauge"><div class="g"><svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="38" fill="none" stroke="var(--off)" stroke-width="12"/>${pct != null ? `<circle cx="48" cy="48" r="38" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - R)}" transform="rotate(-90 48 48)"/>` : ''}</svg><b style="color:${col}">${pct != null ? `${pct}<small>%</small>` : '新'}</b></div>
      <div class="t">${pct != null ? `现在想起它的概率约 <b>${pct}%</b>。` : '还没学过。'}<br>${S ? `记忆稳定性 <b>${S >= 60 ? (S / 30).toFixed(1) + ' 个月' : S < 1 ? (S * 24).toFixed(0) + ' 小时' : S.toFixed(1) + ' 天'}</b>` : '第一次见到它'}</div></div>
    ${curve}
    <div class="facts"><div><span>当前间隔</span><b>${c.type === 0 ? '新' : c.type === 2 ? zh(SCH.intervalLabel('days', c.ivl)) : '学习中'}</b></div><div><span>难度</span><b>${D ? D.toFixed(1) + ' / 10' : '—'}</b></div><div><span>复习次数</span><b>${c.reps}</b></div><div><span>遗忘次数</span><b style="${c.lapses >= 8 ? 'color:var(--lrn)' : ''}">${c.lapses}</b></div></div>
    ${hist.length ? `<div><h3 style="margin-bottom:10px">历次评分 <span style="letter-spacing:0;font-weight:600">最近 ${Math.min(hist.length, 16)} 次</span></h3><div class="hist">${hist.slice(-16).map(r => `<i style="background:${gcol(r.ease)}" title="${new Date(r.id).toLocaleDateString('zh-CN')}">${r.ease}</i>`).join('')}</div></div>` : ''}
    <div><h3 style="margin-bottom:10px">为什么现在出现</h3><div class="why">${why}</div></div>`;
}
function reveal() {
  if (!sess || shown || $('#rv').classList.contains('finished')) return;
  const c = byId(sess.cur); shown = true;
  $('#front').innerHTML = frontHtml(c, true);
  $('#back').classList.add('on'); $('#showBtn').classList.add('off'); $('#grades').classList.add('on');
}
function press(el) { el.classList.add('press'); setTimeout(() => el.classList.remove('press'), 90); }
function grade(g) {
  if (!sess || !shown) return;
  press($(`.g${g}`));
  const c = byId(sess.cur), before = c.type === 0 ? '新' : c.type === 2 ? zh(SCH.intervalLabel('days', c.ivl)) : '学习中';
  sess.undo.push({ card: JSON.stringify(c), rl: db.revlog.length, main: [...sess.main], log: sess.log.length, done: sess.done });
  if (sess.main[0] === c.id) sess.main.shift();
  const secs = Math.min(60, (Date.now() - sess.shownAt) / 1000);
  const u = answer(c, g, nowMs(), secs);
  sess.done++;
  sess.log.push({ id: c.id, g, before, after: zh(u.outcome.label), state: u.outcome.state });
  if (g === 1) { const p = $('#cL'); p.classList.add('bump'); setTimeout(() => p.classList.remove('bump'), 200); toast(`${zh(u.outcome.label)}后再见到它`); }
  if (u.leech) toast('这张卡忘了 8 次，已标为难点卡');
  save();
  nextCard();
}
function undo() {
  if (!sess || !sess.undo.length || $('#rv').classList.contains('finished')) return;
  const u = sess.undo.pop(), restored = JSON.parse(u.card), i = db.cards.findIndex(c => c.id === restored.id);
  db.cards[i] = restored; db.revlog.length = u.rl; sess.main = u.main; sess.log.length = u.log; sess.done = u.done;
  if (!sess.main.includes(restored.id) && restored.queue !== 1) sess.main.unshift(restored.id);
  save(); sess.cur = restored.id; sess.shownAt = Date.now(); shown = false; sess.prev = preview(restored, nowMs()).map(x => zh(x.outcome.label)); render(restored); toast('已撤销上一次评分');
}
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 1600); }
function finish() {
  $('#rv').classList.add('finished');
  const n = sess.log.length, ok = sess.log.filter(x => x.g > 1).length, secs = Math.round((Date.now() - sess.t0) / 1000);
  const uniq = new Set(sess.log.map(x => x.id)).size;
  $('#finH').textContent = n ? '这一轮复习完了' : '这里暂时没有卡了';
  $('#finLead').textContent = n ? `${uniq} 张卡，回答了 ${n} 次。` : '';
  $('#fAcc').textContent = n ? Math.round(ok / n * 100) + '%' : '—';
  $('#fTime').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const td = today();
  $('#fTom').textContent = db.cards.filter(c => !c.susp && !deckOf(c).paused && ((c.queue === 2 && c.due <= td + 1) || c.queue === 1 || (c.queue === 3 && c.due <= td + 1))).length;
  const last = new Map(); for (const x of sess.log) { const p = last.get(x.id); last.set(x.id, p ? { ...x, before: p.before, fails: (p.fails || 0) + (x.g === 1) } : { ...x, fails: +(x.g === 1) }); }
  $('#gains').innerHTML = [...last.values()].slice(-12).map((x, k) => { const c = byId(x.id); const d = deckOf(c); const f = frontHtml(c, false).replace(/<[^>]+>/g, '').replace('［…］', '___'); return `<div class="gl" style="animation:rise .3s ${.15 + k * .04}s var(--ease) both"><i style="background:${d.c}"></i><span class="f">${f}</span><span class="s">${x.before}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-5-5 5 5-5 5"/></svg><b class="${x.fails ? 'bad' : ''}">${x.after}</b></span></div>`; }).join('') || '<div class="empty">没有复习记录</div>';
  if (n) confetti();
}
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas'); cv.className = 'confetti'; document.body.append(cv);
  const ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
  const cols = ['#f26a3d', '#1fae7a', '#3d8bf0', '#f7b500', '#d24877', '#7857cf'];
  const ox = W > 760 ? (W - Math.min(W - 64, 880)) / 2 + 130 : W / 2;
  const ps = Array.from({ length: 110 }, () => ({ x: ox, y: H * .3, vx: (Math.random() - .5) * 16, vy: -Math.random() * 13 - 4, r: Math.random() * 6.28, vr: (Math.random() - .5) * .4, w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, c: cols[Math.random() * 6 | 0] }));
  const s = performance.now();
  (function f(t) {
    ctx.clearRect(0, 0, W, H); const age = (t - s) / 1000;
    for (const p of ps) { p.vy += .38; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.globalAlpha = Math.max(0, 1 - age / 2); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
    if (age < 2) requestAnimationFrame(f); else cv.remove();
  })(s);
}

/* ======================= 浏览 ======================= */
let filt = 'all', sel = null;
function dueText(c) {
  if (c.susp) return ['已暂停', 'color:var(--ink-4)'];
  if (c.type === 0) return ['新卡', 'color:var(--new);font-weight:700'];
  const ms = nowMs(), td = dayOf(ms);
  if (c.queue === 1) { const m = Math.round((c.due * 1000 - ms) / 60000); return [m <= 0 ? '现在' : `${m} 分后`, 'color:var(--lrn);font-weight:700']; }
  const d = c.due - td;
  return d < 0 ? [`过期 ${-d} 天`, 'color:var(--lrn);font-weight:700'] : d === 0 ? ['今天', 'color:var(--rev);font-weight:700'] : d === 1 ? ['明天', ''] : [`${d} 天后`, ''];
}
function filterFns() {
  const t = timeAt(nowMs());
  return {
    all: () => true, due: c => !c.susp && (isReviewDue(c, t.today)), new: c => c.type === 0, lrn: c => c.queue === 1 || c.queue === 3,
    leech: c => c.tags.includes('难点'), flag: c => !!c.flag, susp: c => c.susp,
  };
}
function matchFilter(c) {
  const F = filterFns();
  if (F[filt]) return F[filt](c);
  if (filt.startsWith('deck:')) return c.deck === filt.slice(5);
  if (filt.startsWith('tag:')) return c.tags.includes(filt.slice(4));
  return true;
}
function renderFilters() {
  const F = filterFns(), n = f => db.cards.filter(f).length;
  const b = (id, label, cnt, dot) => `<button class="${filt === id ? 'on' : ''}" data-f="${esc(id)}">${dot ? `<i style="background:${dot}"></i>` : '<span></span>'}<span>${esc(label)}</span><span>${cnt}</span></button>`;
  const tags = new Map(); db.cards.forEach(c => c.tags.forEach(t => tags.set(t, (tags.get(t) || 0) + 1)));
  $('#filters').innerHTML = `<h4>卡组</h4>${b('all', '全部', db.cards.length)}${Object.entries(db.decks).map(([k, d]) => b('deck:' + k, d.name, n(c => c.deck === k), d.c)).join('')}
    <h4>状态</h4>${b('due', '今天到期', n(F.due), 'var(--rev)')}${b('new', '新卡', n(F.new), 'var(--new)')}${b('lrn', '学习中', n(F.lrn), 'var(--lrn)')}${b('leech', '难点卡', n(F.leech), 'var(--lrn)')}${b('flag', '已标记', n(F.flag), 'var(--hard)')}${b('susp', '已暂停', n(F.susp), 'var(--ink-4)')}
    <h4>标签</h4>${[...tags].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, c]) => b('tag:' + t, t, c)).join('')}`;
}
function plain(h) { return h.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '$1').replace(/<[^>]+>/g, ''); }
function renderBrowse() {
  renderFilters();
  const q = $('#q').value.trim().toLowerCase(), ms = nowMs();
  const rows = db.cards.filter(c => matchFilter(c) && (!q || (plain(c.front) + ' ' + plain(c.back) + ' ' + c.tags.join(' ')).toLowerCase().includes(q)));
  if (!rows.some(c => c.id === sel)) sel = rows[0]?.id ?? null;
  $('#rows').innerHTML = rows.slice(0, 300).map(c => {
    const R = retr(c, ms), pct = R == null ? null : Math.round(R * 100), [dt, ds] = dueText(c), d = deckOf(c);
    const col = pct == null ? '' : pct < 80 ? 'var(--lrn)' : pct < 90 ? 'var(--hard)' : 'var(--rev)';
    return `<tr class="${c.id === sel ? 'sel' : ''}" data-id="${c.id}"><td class="f">${c.flag ? '<span style="color:var(--lrn)">⚑ </span>' : ''}${esc(plain(c.front))}</td><td><span class="dk"><i style="background:${d.c}"></i>${esc(d.name)}</span></td><td style="${ds}">${dt}</td><td>${c.type === 2 ? zh(SCH.intervalLabel('days', c.ivl)) : '—'}</td><td>${pct == null ? '<span style="color:var(--ink-4)">—</span>' : `<span class="rbar"><i><b style="width:${pct}%;background:${col}"></b></i>${pct}%</span>`}</td><td style="${c.lapses >= 8 ? 'color:var(--lrn);font-weight:700' : 'color:var(--ink-3)'}">${c.lapses}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">没有匹配的卡片</td></tr>';
  renderEditor();
}
function renderEditor() {
  const c = byId(sel);
  if (!c) { $('#ed').innerHTML = '<div class="empty">选一张卡片查看</div>'; return; }
  $('#ed').innerHTML = `<div class="prev"><div class="q">${frontHtml(c, false)}</div><div class="a">${c.kind === 'cloze' ? frontHtml(c, true) : c.back}</div></div>
    <div class="fld"><label>${c.kind === 'cloze' ? '填空文字' : '正面'}</label><div class="in" contenteditable="true" data-k="front">${c.front}</div></div>
    <div class="fld"><label>${c.kind === 'cloze' ? '补充说明' : '背面'}</label><div class="in" contenteditable="true" data-k="back">${c.back}</div></div>
    <div class="fld"><label>标签</label><div class="chipset">${c.tags.map(t => `<span>${esc(t)}</span>`).join('') || '<span style="background:none;color:var(--ink-3)">没有标签</span>'}</div></div>
    <div class="row"><button class="btn ghost" style="flex:1" data-act="susp">${c.susp ? '恢复' : '暂停'}</button><button class="btn ghost" style="flex:1" data-act="flag">${c.flag ? '取消标记' : '标记'}</button><button class="btn ghost" style="flex:1" data-act="forget">重置为新卡</button></div>`;
  $$('#ed [data-k]').forEach(el => el.addEventListener('blur', () => { c[el.dataset.k] = el.innerHTML; save(); renderBrowse(); }));
}
$('#rows').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) { sel = +tr.dataset.id; renderBrowse(); } });
$('#ed').addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (!a) return; const c = byId(sel);
  if (a.dataset.act === 'susp') { c.susp = !c.susp; toast(c.susp ? '已暂停，不会再出现在复习里' : '已恢复'); }
  if (a.dataset.act === 'flag') c.flag = c.flag ? 0 : 1;
  if (a.dataset.act === 'forget') { Object.assign(c, { type: 0, queue: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, data: '', lastIvl: 0, due: -1 }); delete c.introDay; c.tags = c.tags.filter(t => t !== '难点'); toast('已重置为新卡，会排在新卡最前面'); }
  save(); renderBrowse();
});
$('#filters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; filt = b.dataset.f; $('#qChip').textContent = filt === 'all' ? '全部卡片' : b.querySelector('span:nth-child(2)').textContent; renderBrowse(); });
$('#q').oninput = renderBrowse;

/* ======================= 添加 / 编辑 ======================= */
let mode = { kind: 'add', type: 'basic' };
function fillDeckSelect(selId) {
  $('#mDeck').innerHTML = Object.entries(db.decks).map(([k, d]) => `<option value="${k}"${k === selId ? ' selected' : ''}>${esc(d.name)}</option>`).join('') + '<option value="__new">＋ 新建卡组…</option>';
  $('#newDeck').classList.toggle('on', selId === '__new');
}
function setType(t) {
  mode.type = t; $$('#ntype button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#lFront').textContent = t === 'cloze' ? '填空文字' : '正面';
  $('#lBack').textContent = t === 'cloze' ? '补充说明（可不填）' : '背面';
  $('#fFront').dataset.ph = t === 'cloze' ? '用 {{c1::答案}} 标出要挖空的部分，例如：法国的首都是{{c1::巴黎}}' : '问题';
  $('#fBack').dataset.ph = t === 'cloze' ? '' : '答案';
}
function openAdd(deckId) {
  mode = { kind: 'add', type: mode.type || 'basic' };
  $('#mTitle').textContent = '添加卡片'; $('#mOpts').style.display = ''; $('#mHint').textContent = '保留卡组和标签，可以连续添加';
  $('#addOk').innerHTML = '添加 <kbd>Ctrl Enter</kbd>';
  fillDeckSelect(deckId || db.lastDeck || 'jp'); setType(mode.type);
  $('#fFront').innerHTML = ''; $('#fBack').innerHTML = '';
  $('#scrim').classList.add('on'); setTimeout(() => (deckId === '__new' ? $('#newDeckName') : $('#fFront')).focus(), 30);
}
function openEdit(c) {
  mode = { kind: 'edit', id: c.id };
  $('#mTitle').textContent = '编辑卡片'; $('#mOpts').style.display = 'none'; $('#newDeck').classList.remove('on'); $('#mHint').textContent = '改动会立刻生效，不影响排期';
  $('#addOk').innerHTML = '保存 <kbd>Ctrl Enter</kbd>';
  $('#lFront').textContent = c.kind === 'cloze' ? '填空文字' : '正面'; $('#lBack').textContent = c.kind === 'cloze' ? '补充说明' : '背面';
  $('#fFront').innerHTML = c.front; $('#fBack').innerHTML = c.kind === 'cloze' ? c.back : c.back + (c.extra ? '<br>' + c.extra : '');
  $('#fTags').value = c.tags.join(' ');
  $('#scrim').classList.add('on'); setTimeout(() => $('#fFront').focus(), 30);
}
function closeModal() { $('#scrim').classList.remove('on'); document.activeElement?.blur(); }
function clean(el) { return el.innerHTML.replace(/<div>/g, '<br>').replace(/<\/div>/g, '').replace(/(<br>\s*)+$/, '').replace(/^(&nbsp;|\s)+|(&nbsp;|\s)+$/g, ''); }
function submitModal() {
  const front = clean($('#fFront')), back = clean($('#fBack')), tags = $('#fTags').value.split(/\s+/).filter(Boolean);
  if (mode.kind === 'edit') {
    const c = byId(mode.id); c.front = front; if (c.kind === 'cloze') c.back = back; else { c.back = back; c.extra = ''; } c.tags = tags; save(); closeModal(); toast('已保存');
    if (sess && sess.cur === c.id) render(c); return;
  }
  if (!plain(front).trim()) { toast('正面不能为空'); $('#fFront').focus(); return; }
  let deck = $('#mDeck').value;
  if (deck === '__new') {
    const name = $('#newDeckName').value.trim(); if (!name) { toast('给新卡组起个名字'); $('#newDeckName').focus(); return; }
    deck = 'd' + Date.now().toString(36); const [c1, c2] = EXTRA_COLORS[Object.keys(db.decks).length % EXTRA_COLORS.length];
    db.decks[deck] = { name, ab: [...name][0], c: c1, d: c2, paused: false };
    fillDeckSelect(deck); $('#newDeckName').value = '';
  }
  if (mode.type !== 'cloze' && !plain(back).trim()) { toast('背面不能为空'); $('#fBack').focus(); return; }
  const base = { deck, tags, type: 0, queue: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, data: '', lastIvl: 0, flag: 0, susp: false, hint: '', extra: '' };
  const pos = Math.max(0, ...db.cards.map(c => c.due && c.type === 0 ? c.due : 0)) + 1;
  const made = [];
  if (mode.type === 'cloze') {
    const ords = [...new Set([...front.matchAll(/\{\{c(\d+)::/g)].map(m => +m[1]))];
    if (!ords.length) { toast('填空卡需要至少一个 {{c1::…}}'); return; }
    for (const o of ords) made.push({ ...base, kind: 'cloze', ord: o, front, back });
  } else {
    made.push({ ...base, kind: 'basic', front, back });
    if (mode.type === 'rev') made.push({ ...base, kind: 'basic', front: back, back: front });
  }
  made.forEach((c, i) => db.cards.push({ ...c, id: db.nextId++, due: pos + i }));
  db.lastDeck = deck; save();
  $('#fFront').innerHTML = ''; $('#fBack').innerHTML = ''; $('#fFront').focus();
  toast(`已添加 ${made.length} 张到「${db.decks[deck].name}」`);
  renderHome();
}
$('#mDeck').onchange = () => { $('#newDeck').classList.toggle('on', $('#mDeck').value === '__new'); if ($('#mDeck').value === '__new') $('#newDeckName').focus(); };
$$('#ntype button').forEach(b => b.onclick = () => setType(b.dataset.t));
$('#addOk').onclick = submitModal;
$$('[data-close]').forEach(b => b.onclick = closeModal);
$('#scrim').onclick = e => { if (e.target.id === 'scrim') closeModal(); };

/* ======================= 设置与演示时间 ======================= */
function renderMenu() { $('#drIn').value = Math.round(db.dr * 100); $('#drOut').textContent = Math.round(db.dr * 100) + '%'; $('#npOut').textContent = db.newPerDay; }
$('#openMenu').onclick = e => { e.stopPropagation(); renderMenu(); $('#menu').classList.toggle('on'); };
document.addEventListener('click', e => { if (!e.target.closest('#menu') && !e.target.closest('#openMenu')) $('#menu').classList.remove('on'); });
$('#drIn').oninput = () => { db.dr = +$('#drIn').value / 100; $('#drOut').textContent = $('#drIn').value + '%'; save(); renderHome(); };
$('#npMinus').onclick = () => { db.newPerDay = Math.max(0, db.newPerDay - 1); save(); renderMenu(); renderHome(); };
$('#npPlus').onclick = () => { db.newPerDay = Math.min(50, db.newPerDay + 1); save(); renderMenu(); renderHome(); };
$('#reset').onclick = () => { if (confirm('重置后，你的复习记录和添加的卡片都会清空。继续吗？')) { seed(); $('#menu').classList.remove('on'); renderHome(); toast('已重置演示数据'); } };
function nextDay() { db.offset++; save(); renderHome(); if ($('#browse').classList.contains('on')) renderBrowse(); toast(`现在是第 ${db.offset} 天后，到期的卡已经更新`); }
$('#nextDay').onclick = nextDay;
function learnMore() { const td = today(); db.extra = { day: td, n: (db.extra.day === td ? db.extra.n : 0) + 10 }; save(); renderHome(); }

/* ======================= 导航与快捷键 ======================= */
function view(id) {
  $$('.view').forEach(v => v.classList.toggle('on', v.id === id));
  $('#openSearch').style.visibility = id === 'browse' ? 'hidden' : '';
  if (id === 'browse') { renderBrowse(); setTimeout(() => $('#q').focus(), 0); } else renderHome();
  scrollTo(0, 0);
}
$('#openSearch').onclick = () => view('browse');
$('#brand').onclick = () => view('home');
$('#openAdd').onclick = () => openAdd();
$('#showBtn').onclick = () => reveal();
$$('#grades .btn').forEach(b => b.onclick = () => grade(+b.dataset.g));
$('#undo').onclick = undo;
$('#sideB').onclick = () => { sideOn = !sideOn; $('#rv').classList.toggle('noside', !sideOn); };
$('#flagB').onclick = () => { const c = byId(sess.cur); c.flag = c.flag ? 0 : 1; save(); $('#flag').classList.toggle('on', !!c.flag); toast(c.flag ? '已标记' : '已取消标记'); };
$('#bury').onclick = () => { const c = byId(sess.cur); c.buried = today(); if (sess.main[0] === c.id) sess.main.shift(); save(); toast('这张卡明天再出现'); nextCard(); };
$('#edit').onclick = () => openEdit(byId(sess.cur));
$('#more').onclick = () => { learnMore(); startReview(sess?.scope === 'due' ? 'all' : sess?.scope || 'all'); };
document.addEventListener('click', e => {
  const s = e.target.closest('[data-start]');
  if (s && !e.target.closest('#scrim')) {
    const id = s.dataset.start, d = db.decks[id];
    if (d && d.paused) { d.paused = false; save(); renderHome(); toast(`已恢复「${d.name}」，过期的卡今天开始复习`); return; }
    startReview(id); return;
  }
  if (e.target.closest('[data-exit]')) exitReview();
  if (e.target.closest('[data-nextday]')) nextDay();
  if (e.target.closest('#learnMore')) { learnMore(); toast('今天多学 10 张新卡'); }
  if (e.target.closest('#newDeckT')) openAdd('__new');
});
addEventListener('keydown', e => {
  const typing = e.target.closest('input,select,[contenteditable]');
  if ($('#scrim').classList.contains('on')) { if (e.key === 'Escape') closeModal(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitModal(); } return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if ($('#rv').classList.contains('on')) {
    if (e.key === 'Escape') return exitReview();
    if ($('#rv').classList.contains('finished')) { if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); exitReview(); } return; }
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); if (!shown) { press($('#showBtn')); reveal(); } else grade(3); }
    else if (['1', '2', '3', '4'].includes(e.key)) grade(+e.key);
    else if (e.key === 'z') undo(); else if (e.key === 'i') $('#sideB').click(); else if (e.key === 'f') $('#flagB').click(); else if (e.key === '-') $('#bury').click(); else if (e.key === 'e') { e.preventDefault(); $('#edit').click(); }
    return;
  }
  if (typing) { if (e.key === 'Escape') { e.target.blur(); view('home'); } return; }
  if (e.key === '/') { e.preventDefault(); view('browse'); }
  else if (e.key === 'a') { e.preventDefault(); openAdd(); }
  else if (e.code === 'Space' && $('#home').classList.contains('on')) { e.preventDefault(); const c = countsFor('all'); if (c.n + c.l + c.r) startReview('all'); }
  else if (e.key === 'Escape') view('home');
});

db = load();
if (!db) seed();
view('home');
