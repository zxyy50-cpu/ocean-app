// Animated backdrops for the themed skins: a layer fixed behind the app, never clickable.
// 深海: dolphins and whales of several kinds swimming across, bubbles rising.
// 龍焰奇幻: embers rising, now and then a dragon flying over.
// 魔法學院: twinkling stars, floating candles, now and then an owl.
// All drawings are simple original silhouettes. With 「減少動態效果」 on, nothing moves.

const SEA = {
  dolphin: { box: "0 0 120 48", body: '<path class="c" d="M4 20 L12 26 L4 33 L10 34 L18 29 C30 37 58 40 84 34 C96 31 106 29 118 27 C110 25 102 22 94 21 C90 14 80 10 66 10 C60 3 56 1 52 2 C55 6 55 9 53 11 C40 12 26 18 18 23 L10 18 Z"/><path class="c" d="M62 34 C60 41 55 45 50 46 C53 41 55 37 56 34 Z"/><circle class="l" cx="98" cy="23" r="1.4"/>' },
  humpback: { box: "0 0 220 80", body: '<path class="c" d="M4 30 L18 38 L6 48 L14 49 L28 42 C50 56 110 62 160 56 C185 53 205 48 216 40 C214 34 205 30 192 28 C170 20 130 18 100 20 C96 16 92 15 88 16 C90 19 90 21 88 22 C64 24 42 30 28 36 L14 27 Z"/><path class="c" d="M150 54 C140 66 120 76 100 78 C118 70 132 62 140 54 Z"/><path class="g" d="M170 50 L206 44 M168 53 L204 47 M166 56 L200 50"/>' },
  blue: { box: "0 0 260 60", body: '<path class="c" d="M4 24 L16 30 L4 38 L12 39 L26 33 C70 44 150 46 210 40 C232 38 248 34 256 29 C248 24 232 21 210 20 C160 16 100 17 60 22 C56 18 54 17 52 18 C53 20 53 22 52 23 C42 25 32 28 26 30 L12 22 Z"/><path class="c" d="M200 40 C196 46 188 50 180 51 C186 46 190 42 192 40 Z"/>' },
  orca: { box: "0 0 140 70", body: '<path class="c" d="M4 36 L14 42 L4 50 L12 51 L22 45 C40 56 80 60 110 54 C122 51 132 46 136 40 C132 34 122 30 108 29 C100 28 92 28 84 29 C82 18 80 8 76 2 C72 10 68 20 64 30 C48 32 32 37 22 42 L12 33 Z"/><ellipse class="l" cx="113" cy="36" rx="7" ry="2.6"/><path class="l" d="M96 52 C108 50 122 46 130 42 C124 48 114 53 100 55 Z"/>' },
  sperm: { box: "0 0 200 64", body: '<path class="c" d="M4 28 L16 34 L6 44 L14 45 L28 38 C60 50 110 56 150 54 L188 54 C195 54 198 48 198 38 L198 24 C198 16 194 12 186 12 L150 12 C120 12 80 16 50 24 C40 27 32 30 28 33 L16 24 Z"/><path class="g" d="M152 54 L194 48"/>' },
  beluga: { box: "0 0 120 52", body: '<path class="w" d="M4 24 L14 29 L6 37 L13 38 L22 33 C40 42 70 46 92 42 C104 40 112 36 116 30 C118 24 116 16 108 13 C100 10 90 12 84 16 C66 14 44 18 30 24 C26 26 24 28 22 30 L13 21 Z"/><circle class="c" cx="104" cy="22" r="1.6"/>' },
};

// [kind, top %, width px, seconds per crossing, start offset s, direction (1 → right, -1 ← left), resting place vw]
const SWIMMERS = [
  ["blue", 10, 280, 150, -40, 1, 8],
  ["dolphin", 26, 110, 34, -6, 1, 55],
  ["dolphin", 30, 88, 34, -9, 1, 62],
  ["dolphin", 23, 96, 34, -11, 1, 68],
  ["beluga", 44, 110, 85, -50, -1, 30],
  ["humpback", 56, 220, 110, -70, -1, 70],
  ["orca", 70, 140, 64, -20, 1, 18],
  ["orca", 74, 120, 64, -24, 1, 26],
  ["sperm", 86, 200, 130, -95, -1, 48],
  ["dolphin", 38, 100, 46, -30, -1, 82],
];

const DRAGON = '<svg class="flyer-art" viewBox="0 0 200 90" aria-hidden="true"><path class="wing back" d="M110 45 C112 28 118 14 132 2 C128 18 130 28 136 34 C128 38 120 42 114 46 Z"/><path class="c" d="M20 50 C40 46 70 44 100 46 C118 47 130 44 140 38 C146 34 152 32 160 33 L176 30 L182 34 L172 38 C164 40 156 42 150 46 C140 54 120 58 100 58 C80 58 60 60 44 66 C30 72 16 78 4 86 C10 76 18 68 26 62 C16 62 8 60 2 56 C10 54 16 52 20 50 Z"/><path class="wing" d="M96 46 C90 30 80 14 64 4 C70 18 66 26 58 30 C62 34 70 38 78 44 Z"/><circle class="eye" cx="168" cy="33" r="1.4"/></svg>';
const OWL = '<svg class="flyer-art" viewBox="0 0 84 50" aria-hidden="true"><path class="wing" d="M33 22 C21 12 9 12 2 18 C12 19 21 24 31 29 Z"/><path class="wing right" d="M51 22 C63 12 75 12 82 18 C72 19 63 24 53 29 Z"/><path class="c" d="M31 22 C31 14 36 10 42 10 C48 10 53 14 53 22 C53 32 48 38 42 38 C36 38 31 32 31 22 Z"/><path class="c" d="M34 13 L35 6 L39 11 Z M50 13 L49 6 L45 11 Z"/><circle class="eye" cx="38" cy="19" r="2.2"/><circle class="eye" cx="46" cy="19" r="2.2"/></svg>';

const pick = (index, list) => list[index % list.length];

function oceanLayer() {
  const swimmers = SWIMMERS.map(([kind, top, width, seconds, delay, direction, rest]) => {
    const art = SEA[kind];
    return `<div class="swimmer${direction < 0 ? " left" : ""} k-${kind}" style="--top:${top}%;--w:${width}px;--dur:${seconds}s;--delay:${delay}s;--rest:${rest}vw"><div class="bob"><svg viewBox="${art.box}" aria-hidden="true">${art.body}</svg></div></div>`;
  }).join("");
  const bubbles = Array.from({ length: 16 }, (_, i) => `<i class="bubble" style="--x:${(i * 37) % 100}%;--s:${4 + (i % 4) * 3}px;--dur:${9 + (i % 5) * 3}s;--delay:${-i * 1.7}s"></i>`).join("");
  return { back: `<div class="rays"></div>${swimmers}${bubbles}<div class="seabed"></div>`, front: "" };
}

function fantasyLayer() {
  const embers = Array.from({ length: 26 }, (_, i) => `<i class="ember" style="--x:${(i * 41) % 100}%;--s:${2 + (i % 3)}px;--dur:${7 + (i % 6) * 1.6}s;--delay:${-i * 0.9}s;--drift:${pick(i, [-40, 25, -15, 50, 10, -30])}px"></i>`).join("");
  return { back: `<div class="haze"></div>${embers}`, front: `<div class="flyer dragon">${DRAGON}</div>` };
}

function wizardLayer() {
  const stars = Array.from({ length: 42 }, (_, i) => `<i class="twinkle-star" style="--x:${(i * 53) % 100}%;--y:${(i * 29) % 70}%;--s:${1 + (i % 3)}px;--dur:${2 + (i % 4)}s;--delay:${-i * 0.37}s"></i>`).join("");
  const candles = Array.from({ length: 8 }, (_, i) => `<i class="candle" style="--x:${6 + i * 12}%;--y:${6 + (i % 3) * 7}%;--h:${22 + (i % 3) * 8}px;--dur:${6 + (i % 4)}s;--delay:${-i * 1.3}s"></i>`).join("");
  return { back: `${stars}${candles}`, front: `<div class="flyer owl">${OWL}</div>` };
}

const LAYERS = { ocean: oceanLayer, fantasy: fantasyLayer, wizard: wizardLayer };

// Swimmers, embers and stars live behind the app; a passing dragon or owl crosses over it
// (see-through, never clickable), otherwise the cards would hide it.
export function mountDecor(id, doc = globalThis.document) {
  if (!doc?.body) return;
  const current = doc.querySelector(".skin-decor");
  if (current?.dataset.decor === id) return;
  doc.querySelectorAll(".skin-decor, .skin-decor-front").forEach((node) => node.remove());
  if (!LAYERS[id]) return;
  const { back, front } = LAYERS[id]();
  const make = (className, html) => {
    const layer = doc.createElement("div");
    layer.className = className;
    layer.dataset.decor = id;
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = html;
    return layer;
  };
  doc.body.prepend(make("skin-decor", back));
  if (front) doc.body.append(make("skin-decor-front", front));
}
