// Animated backdrops for the themed skins: a layer fixed behind the app, never clickable.
// 深海: dolphins and whales of several kinds swimming across, bubbles rising.
// 龍焰奇幻: embers rising, now and then a dragon flying over.
// 魔法學院: twinkling stars, floating candles, now and then an owl.
// All drawings are original, drawn to each animal's real proportions and colouring
// (dark back, pale belly). With 「減少動態效果」 on, nothing moves.

// A vertical gradient: dark back → pale belly.
const shade = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([at, color]) => `<stop offset="${at}" stop-color="${color}"/>`).join("")}</linearGradient>`;

// Each drawing faces right; `u` keeps gradient ids unique per copy.
const SEA = {
  // Bottlenose dolphin: short beak, rounded melon, curved (falcate) dorsal fin, grey back, pale belly.
  dolphin: { box: "0 0 300 110", art: (u) => `<defs>${shade(`d${u}`, [[0, "#2c566b"], [0.5, "#5b889e"], [0.72, "#c9dfe8"], [1, "#eef6f9"]])}</defs>
    <path fill="#2c566b" d="M146 46 C150 30 150 16 140 6 C160 12 180 28 192 40 Z"/>
    <path fill="url(#d${u})" d="M296 62 C290 58 280 56 270 55 C262 44 248 38 230 38 C200 38 170 40 150 44 C120 50 90 58 60 64 C45 67 32 68 22 68 C14 60 8 52 2 48 C8 58 12 66 16 72 C10 80 6 88 2 94 C14 86 22 80 30 76 C60 82 100 88 140 88 C190 88 240 80 270 70 C280 67 290 65 296 62 Z"/>
    <path fill="#3d6a80" d="M222 78 C214 90 204 100 192 104 C204 92 208 84 210 78 Z"/>
    <path fill="none" stroke="#1d3b4a" stroke-width="1.6" stroke-linecap="round" d="M296 62 C286 64 274 64 264 62"/>
    <circle cx="252" cy="57" r="2.4" fill="#0b1418"/>` },
  // Humpback: flat knobbly head, very long white flippers, small hump-like dorsal fin, throat grooves.
  humpback: { box: "0 0 420 165", art: (u) => `<defs>${shade(`h${u}`, [[0, "#1f313b"], [0.55, "#33505e"], [0.8, "#a9bcc5"], [1, "#d9e4e8"]])}</defs>
    <path fill="url(#h${u})" d="M412 70 C400 60 380 56 360 56 C320 56 280 56 240 58 C200 60 170 62 150 64 C140 56 132 52 126 54 C124 60 120 64 112 66 C80 72 50 76 30 78 C22 66 12 58 2 54 C8 66 12 74 18 82 C10 90 6 100 2 108 C16 98 26 90 34 86 C80 102 140 118 205 122 C285 124 352 108 392 90 C403 85 410 78 412 70 Z"/>
    <g fill="#16252d"><circle cx="392" cy="61" r="2.2"/><circle cx="380" cy="58" r="2.2"/><circle cx="368" cy="57" r="2"/><circle cx="356" cy="57" r="1.8"/><circle cx="386" cy="66" r="1.6"/></g>
    <path fill="none" stroke="#7c919b" stroke-width="1.2" d="M398 86 C360 104 320 114 290 118 M394 90 C356 107 318 117 292 120 M388 94 C352 110 318 119 296 121"/>
    <path fill="#e9f0f3" stroke="#2a3e48" stroke-width="1.2" d="M332 102 C312 126 282 146 238 158 C250 152 260 145 268 137 C284 123 300 110 314 102 Z"/>
    <path fill="none" stroke="#14232b" stroke-width="1.6" stroke-linecap="round" d="M412 70 C392 76 372 78 352 78"/>
    <circle cx="352" cy="72" r="2.4" fill="#0b1418"/>` },
  // Blue whale: the longest and most slender, broad flat head, a tiny dorsal fin far back, mottled blue-grey.
  blue: { box: "0 0 520 110", art: (u) => `<defs>${shade(`b${u}`, [[0, "#42667b"], [0.6, "#6b90a4"], [1, "#a8c3d0"]])}</defs>
    <path fill="url(#b${u})" d="M514 52 C506 44 490 40 470 40 C420 40 360 42 300 44 C240 46 180 48 140 50 C132 46 128 42 124 44 C124 48 122 51 118 52 C90 55 60 58 36 60 C26 50 14 44 2 40 C8 52 12 60 16 66 C10 74 6 82 2 90 C14 82 26 74 36 70 C90 76 160 80 240 80 C340 80 430 74 480 66 C498 63 510 58 514 52 Z"/>
    <g fill="#8db0c1" opacity="0.55"><ellipse cx="380" cy="52" rx="7" ry="3"/><ellipse cx="320" cy="56" rx="9" ry="3"/><ellipse cx="260" cy="52" rx="6" ry="2.5"/><ellipse cx="210" cy="58" rx="8" ry="3"/><ellipse cx="160" cy="55" rx="5" ry="2"/><ellipse cx="420" cy="48" rx="5" ry="2"/></g>
    <path fill="none" stroke="#557a8e" stroke-width="1" d="M500 62 C460 70 420 74 380 76 M494 65 C456 72 418 76 382 78"/>
    <path fill="#557a8e" d="M420 72 C412 82 398 88 384 90 C394 84 400 78 404 72 Z"/>
    <path fill="none" stroke="#24404f" stroke-width="1.6" stroke-linecap="round" d="M514 52 C492 58 462 60 432 60"/>
    <circle cx="452" cy="55" r="2.2" fill="#0b1418"/>` },
  // Orca: tall dorsal fin, black body, white eye patch, white chin and belly, grey saddle behind the fin.
  orca: { box: "0 0 300 140", art: () => `
    <path fill="#11181d" d="M296 80 C290 70 276 64 258 62 C230 60 204 60 182 62 L165 2 L140 66 C110 70 80 74 50 78 C40 79 32 80 24 80 C16 70 8 64 2 60 C6 72 10 80 14 86 C8 94 4 102 2 110 C12 102 22 96 30 92 C70 100 120 108 170 108 C220 108 262 100 284 92 C292 88 296 84 296 80 Z"/>
    <path fill="#7f8c94" d="M184 64 C164 68 144 70 128 70 C146 75 168 74 186 68 Z"/>
    <path fill="#f2f6f8" d="M262 69 C252 62 236 62 228 67 C238 72 252 74 262 69 Z"/>
    <path fill="#f2f6f8" d="M294 84 C280 96 250 104 210 104 C190 104 175 102 166 98 C186 96 220 94 250 90 C270 88 284 86 294 84 Z"/>
    <path fill="#f2f6f8" d="M150 100 C135 92 115 90 100 96 C115 100 132 104 150 104 Z"/>
    <path fill="#0b1013" d="M242 100 C238 116 228 126 212 130 C216 118 220 108 224 100 Z"/>
    <circle cx="268" cy="74" r="2.2" fill="#000"/>` },
  // Sperm whale: a huge square head (a third of the body), narrow underslung jaw, wrinkled grey skin, knuckled back.
  sperm: { box: "0 0 440 130", art: (u) => `<defs>${shade(`s${u}`, [[0, "#3a4045"], [1, "#5f686d"]])}</defs>
    <path fill="url(#s${u})" d="M432 38 C438 42 440 54 438 68 C436 82 430 90 420 92 C380 94 340 96 300 98 C240 102 180 102 130 96 C100 92 70 86 46 82 C34 90 20 102 2 114 C14 98 20 88 22 80 C14 72 8 62 2 48 C18 58 32 68 46 74 C80 68 110 62 140 60 C150 54 160 52 168 56 C180 52 200 48 230 44 C280 38 340 34 400 34 C416 34 426 35 432 38 Z"/>
    <g fill="none" stroke="#2a2f33" stroke-width="1.2" stroke-linecap="round" opacity="0.7"><path d="M250 60 c6 4 12 4 18 0"/><path d="M220 70 c6 4 12 4 18 0"/><path d="M190 64 c6 4 12 4 18 0"/><path d="M280 76 c6 4 12 4 18 0"/><path d="M160 74 c6 4 12 4 18 0"/><path d="M196 52 l4 -4 l4 4"/><path d="M182 54 l4 -4 l4 4"/></g>
    <path fill="#dfe5e8" d="M420 92 C390 98 340 102 300 102 C330 104 380 102 418 96 Z"/>
    <path fill="#454c51" d="M330 96 C326 106 318 112 306 114 C312 106 316 100 318 96 Z"/>
    <circle cx="330" cy="80" r="2.2" fill="#0b1418"/>` },
  // Beluga: all white, a round bulging forehead, a short beak, a neck crease and no dorsal fin.
  beluga: { box: "0 0 280 110", art: (u) => `<defs>${shade(`w${u}`, [[0, "#fbfdfe"], [0.6, "#e6eff3"], [1, "#c3d5dd"]])}</defs>
    <path fill="url(#w${u})" stroke="#9fb6c1" stroke-width="1" d="M274 66 C270 60 264 58 258 58 C258 46 250 34 232 30 C214 26 196 30 180 34 C160 36 130 38 100 44 C70 50 46 56 30 60 C22 52 12 46 2 44 C8 54 12 62 16 68 C10 76 6 84 2 92 C14 86 24 78 32 74 C70 84 120 92 170 90 C210 88 244 80 262 74 C268 72 272 70 274 66 Z"/>
    <path fill="none" stroke="#b4c8d1" stroke-width="1.4" d="M205 37 C201 45 201 53 205 61"/>
    <path fill="#dbe7ec" stroke="#9fb6c1" stroke-width="1" d="M220 82 C214 94 204 100 194 102 C200 94 206 88 210 82 Z"/>
    <path fill="none" stroke="#7d97a3" stroke-width="1.4" stroke-linecap="round" d="M274 66 C266 70 258 70 250 66"/>
    <circle cx="240" cy="56" r="2.2" fill="#22323a"/>` },
};

// [kind, top %, width px, seconds per crossing, start offset s, direction (1 → right, -1 ← left), resting place vw]
const SWIMMERS = [
  ["blue", 9, 340, 160, -40, 1, 8],
  ["dolphin", 26, 130, 34, -6, 1, 55],
  ["dolphin", 30, 110, 34, -9, 1, 62],
  ["dolphin", 23, 118, 34, -11, 1, 68],
  ["beluga", 44, 130, 85, -50, -1, 30],
  ["humpback", 55, 280, 115, -70, -1, 70],
  ["orca", 70, 170, 64, -20, 1, 18],
  ["orca", 75, 140, 64, -24, 1, 26],
  ["sperm", 86, 250, 135, -95, -1, 48],
  ["dolphin", 38, 120, 46, -30, -1, 82],
];

// A western dragon in flight: horned head on a long neck, bat wings (finger bones and membrane),
// spines along the back, tucked legs and a spade-tipped tail.
const DRAGON = `<svg class="flyer-art" viewBox="0 -90 420 290" aria-hidden="true"><defs>${shade("dragon-body", [[0, "#2e0a08"], [0.6, "#5a1a10"], [1, "#9a4a1e"]])}${shade("dragon-wing", [[0, "#6e1c14"], [1, "#3a0d0a"]])}</defs>
  <g class="wing back" style="transform-origin:256px 92px"><g transform="translate(256 92) scale(1.45) translate(-256 -92)"><path fill="url(#dragon-wing)" opacity="0.8" d="M256 92 L286 30 L270 0 Q262 24 234 14 Q230 36 210 40 Q236 66 262 96 Z"/><path fill="none" stroke="#1f0504" stroke-width="2.4" stroke-linecap="round" d="M256 92 L286 30 L270 0 M286 30 L234 14 M286 30 L210 40"/></g></g>
  <path fill="url(#dragon-body)" d="M392 60 C400 61 408 65 410 70 C402 74 392 76 382 75 C372 76 362 82 352 90 C332 104 300 110 278 114 C268 128 246 138 214 138 C192 138 174 132 160 124 C128 130 92 146 58 154 C44 157 30 158 20 158 L4 150 L18 148 L8 136 L30 148 C64 142 104 124 148 108 C176 98 206 92 236 92 C268 92 296 80 320 64 C334 54 348 48 362 48 C374 48 384 54 392 60 Z"/>
  <path fill="none" stroke="#c0763a" stroke-width="3" stroke-dasharray="3 3" opacity="0.7" d="M352 92 C320 108 292 114 278 118 C266 132 240 140 214 140"/>
  <g fill="#2a0806"><path d="M310 72 l3 -10 l6 8 Z"/><path d="M290 84 l3 -10 l6 8 Z"/><path d="M268 91 l3 -10 l6 8 Z"/><path d="M246 92 l3 -10 l6 8 Z"/><path d="M222 93 l3 -9 l6 8 Z"/><path d="M198 97 l3 -9 l6 8 Z"/><path d="M174 102 l3 -8 l5 7 Z"/><path d="M150 109 l3 -8 l5 7 Z"/><path d="M126 118 l2 -7 l5 6 Z"/><path d="M102 128 l2 -6 l4 5 Z"/></g>
  <path fill="#4a120d" d="M196 134 C192 150 182 160 170 164 L176 166 L168 170 L180 168 C188 160 196 150 204 136 Z"/>
  <path fill="#4a120d" d="M270 118 C276 132 272 142 262 148 L268 150 L260 154 L272 150 C280 142 282 130 278 116 Z"/>
  <path fill="#d8c7a0" d="M356 50 L338 30 L362 46 Z M366 49 L356 28 L372 47 Z"/>
  <path fill="none" stroke="#1f0504" stroke-width="1.6" stroke-linecap="round" d="M410 70 C398 70 388 70 378 68"/>
  <circle class="eye" cx="377" cy="58" r="2.6"/>
  <g class="wing" style="transform-origin:244px 96px"><g transform="translate(244 96) scale(1.6) translate(-244 -96)"><path fill="url(#dragon-wing)" d="M244 96 L262 34 L230 2 Q214 34 176 10 Q166 40 132 30 Q132 56 110 62 Q170 74 230 104 Z"/><path fill="none" stroke="#1f0504" stroke-width="3" stroke-linecap="round" d="M244 96 L262 34 L230 2 M262 34 L176 10 M262 34 L132 30 M262 34 L110 62"/></g></g>
</svg>`;

// A barn owl seen from the front, wings spread: white heart-shaped face, golden wings with fine spots.
const OWL_WING = `<path fill="#d4a865" d="M106 58 C84 44 52 34 6 40 C18 46 26 48 34 50 C40 56 48 56 54 58 C60 64 68 64 74 66 C82 70 90 72 98 74 C102 74 106 72 108 70 Z"/>
  <path fill="none" stroke="#9c7440" stroke-width="1.2" d="M62 44 L40 52 M72 46 L54 58 M82 50 L74 66 M92 54 L90 70"/>
  <g fill="#6f4f2a"><circle cx="70" cy="52" r="1.5"/><circle cx="84" cy="56" r="1.5"/><circle cx="58" cy="47" r="1.3"/><circle cx="94" cy="62" r="1.5"/><circle cx="46" cy="44" r="1.2"/></g>`;
const OWL = `<svg class="flyer-art" viewBox="0 0 240 130" aria-hidden="true">
  <g class="wing" style="transform-origin:106px 60px">${OWL_WING}</g>
  <g transform="translate(240 0) scale(-1 1)"><g class="wing" style="transform-origin:106px 60px">${OWL_WING}</g></g>
  <path fill="#d9b680" d="M110 100 L120 118 L130 100 Z"/>
  <ellipse cx="120" cy="74" rx="17" ry="30" fill="#f3e6cc"/>
  <path fill="#d4a865" d="M100 46 C104 34 114 30 120 30 C126 30 136 34 140 46 C132 40 126 38 120 40 C114 38 108 40 100 46 Z"/>
  <path fill="#fbf7ef" stroke="#c79b5c" stroke-width="1.6" d="M120 44 C110 34 96 38 98 52 C100 64 112 72 120 76 C128 72 140 64 142 52 C144 38 130 34 120 44 Z"/>
  <circle cx="111" cy="54" r="3.2" fill="#1b1209"/><circle cx="129" cy="54" r="3.2" fill="#1b1209"/>
  <path fill="#e1c9a0" d="M120 58 L117 64 L120 68 L123 64 Z"/>
  <ellipse cx="114" cy="104" rx="3" ry="2" fill="#e9dcc4"/><ellipse cx="126" cy="104" rx="3" ry="2" fill="#e9dcc4"/>
</svg>`;

const pick = (index, list) => list[index % list.length];

function oceanLayer() {
  const swimmers = SWIMMERS.map(([kind, top, width, seconds, delay, direction, rest], index) => {
    const art = SEA[kind];
    return `<div class="swimmer${direction < 0 ? " left" : ""} k-${kind}" style="--top:${top}%;--w:${width}px;--dur:${seconds}s;--delay:${delay}s;--rest:${rest}vw"><div class="bob"><svg viewBox="${art.box}" aria-hidden="true">${art.art(index)}</svg></div></div>`;
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

// For checking the drawings side by side (not used by the app itself).
export const DRAWINGS = { sea: SEA, dragon: DRAGON, owl: OWL };
