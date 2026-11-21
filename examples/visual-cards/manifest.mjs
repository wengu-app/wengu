import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const STARTER_DECK = "高中学科 · 视觉回忆卡";

export const STARTER_CARDS = [
  {
    id: "geo.solstice",
    title: "地球公转与二分二至日（极昼极夜）",
    archetype: "3D 空间立体遮挡卡",
    subject: "高中地理",
    tags: ["地理", "地球运动", "视觉卡"],
    front: "夏至日与冬至日时，太阳分别直射哪条纬线？北极圈及其以北分别出现什么现象？",
    back: "<b>夏至日（6月22日前后）</b>：太阳直射北回归线（23°26′N），北极圈及其以北出现<b>极昼</b>（南极圈极夜）。<br><b>冬至日（12月22日前后）</b>：太阳直射南回归线（23°26′S），北极圈及其以北出现<b>极夜</b>（南极圈极昼）。",
    libraries: ["three"],
    sources: [{ title: "普通高中教科书 · 地理 选择性必修1（自然地理基础）" }],
    file: "geo-solstice.js",
    defaultProps: {},
  },
  {
    id: "bio.action-potential",
    title: "动作电位变化曲线与离子通道",
    archetype: "过程断点卡（2D SVG）",
    subject: "高中生物",
    tags: ["生物", "神经调节", "视觉卡"],
    front: "神经纤维受到有效刺激产生动作电位（上升支，从 -70 mV 升至 +30 mV）时，是什么离子以何种方式跨膜移动？膜内外电位如何变化？",
    back: "<b>Na⁺ 通过钠离子通道大量内流</b>（顺浓度梯度，<b>协助扩散</b>），膜电位由“外正内负”反转为“外负内正”；随后 <b>K⁺ 大量外流</b>（协助扩散）使膜电位恢复静息状态。",
    libraries: [],
    sources: [{ title: "普通高中教科书 · 生物学 选择性必修1（稳态与调节）" }],
    file: "bio-action-potential.js",
    defaultProps: {},
  },
  {
    id: "phy.lorentz-force",
    title: "左手定则与洛伦兹力三维方向",
    archetype: "3D 动态变体卡",
    subject: "高中物理",
    tags: ["物理", "电磁场", "视觉卡"],
    front: "如何用左手定则判断运动电荷在匀强磁场中受到的洛伦兹力方向？负电荷需要注意什么？",
    back: "伸开左手，使磁感线 <b>B</b> 垂直穿入手心，四指指向<b>正电荷运动方向 v</b>（若为<b>负电荷 −q 则指向 v 的反方向</b>），拇指所指方向即为洛伦兹力 <b>F</b> 的方向。",
    libraries: ["three"],
    sources: [{ title: "普通高中教科书 · 物理 选择性必修2（安培力与洛伦兹力）" }],
    file: "phy-lorentz-force.js",
    defaultProps: {},
  },
  {
    id: "chem.vsepr-angles",
    title: "CH₄ / NH₃ / H₂O 构型与键角规律",
    archetype: "3D 易混对比卡",
    subject: "高中化学",
    tags: ["化学", "物质结构与性质", "视觉卡"],
    front: "比较 CH₄、NH₃、H₂O 的分子空间构型与键角大小，并说明键角依次减小的原因。",
    back: "<b>CH₄</b> 正四面体（<b>109°28′</b>，0 对孤电子对）＞ <b>NH₃</b> 三角锥形（<b>107°</b>，1 对孤电子对）＞ <b>H₂O</b> V 形（<b>104.5°</b>，2 对孤电子对）。<br>孤电子对对成键电子对的排斥力大于成键电子对之间的排斥力，孤电子对越多，键角被压缩得越小。",
    libraries: ["three"],
    sources: [{ title: "普通高中教科书 · 化学 选择性必修2（物质结构与性质）" }],
    file: "chem-vsepr-angles.js",
    defaultProps: {},
  },
];

export function loadStarterCards() {
  return STARTER_CARDS.map((card) => ({
    ...card,
    source: readFileSync(path.join(here, card.file), "utf8"),
  }));
}
