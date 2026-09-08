/* 生成中式意象的占位画像/生活照(离线可用, 仅作演示素材) */

const enc = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`

const FRAME = `<rect x="22" y="22" width="556" height="716" fill="none" stroke="#f0d9a8" stroke-opacity=".5" stroke-width="2"/>`

function motifLayer(motif: string): string {
  switch (motif) {
    case 'moon':
      return `<circle cx="300" cy="200" r="118" fill="#f7e8c9" opacity=".85"/>
        <path d="M180 250 q60 -26 120 0 q60 26 120 0" stroke="#f7e8c9" stroke-opacity=".5" stroke-width="6" fill="none"/>`
    case 'fan':
      return `<g opacity=".8" fill="#f7e8c9">
        <path d="M300 300 L180 120 A220 220 0 0 1 420 120 Z" opacity=".7"/>
        <path d="M300 300 L230 100 M300 300 L300 88 M300 300 L370 100" stroke="#8f1d2c" stroke-width="5"/></g>`
    case 'blossom':
      return `<g fill="#f7e8c9" opacity=".85">
        <circle cx="300" cy="140" r="42"/><circle cx="228" cy="196" r="42"/><circle cx="372" cy="196" r="42"/>
        <circle cx="256" cy="272" r="42"/><circle cx="344" cy="272" r="42"/>
        <circle cx="300" cy="206" r="30" fill="#c98a2d"/></g>`
    default:
      return `<circle cx="300" cy="200" r="118" fill="#f7e8c9" opacity=".85"/>`
  }
}

/** 人像占位图: 渐变底 + 意象 + 剪影 + 水印字 */
export function portrait(char: string, from: string, to: string, motif: 'moon' | 'fan' | 'blossom' = 'moon'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="760" viewBox="0 0 600 760">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="600" height="760" fill="url(#g)"/>
  ${motifLayer(motif)}
  <circle cx="300" cy="352" r="88" fill="#1c0f0c" opacity=".5"/>
  <path d="M136 760 C158 556 248 466 300 466 C352 466 442 556 464 760 Z" fill="#1c0f0c" opacity=".5"/>
  <text x="300" y="706" font-size="190" text-anchor="middle" fill="#f7e8c9" opacity=".14" font-family="KaiTi, STKaiti, serif">${char}</text>
  ${FRAME}
</svg>`
  return enc(svg)
}

/** 生活照占位图: 山水 / 灯笼 / 花枝 / 亭台 / 湖舟 / 棋局 / 博物 */
export function scene(motif: 'mountains' | 'lantern' | 'pagoda' | 'branch' | 'lake' | 'board' | 'museum', from: string, to: string): string {
  let body: string
  if (motif === 'mountains') {
    body = `<circle cx="452" cy="120" r="62" fill="#f7e8c9" opacity=".9"/>
      <path d="M0 400 L120 210 L228 342 L342 168 L470 356 L600 250 V400 Z" fill="#2a1512" opacity=".55"/>
      <path d="M0 400 L90 300 L210 386 L330 280 L470 392 L600 320 V400 Z" fill="#1c0f0c" opacity=".7"/>`
  } else if (motif === 'lantern') {
    body = `<line x1="300" y1="0" x2="300" y2="86" stroke="#c98a2d" stroke-width="6"/>
      <ellipse cx="300" cy="180" rx="96" ry="88" fill="#c2313f"/>
      <ellipse cx="300" cy="180" rx="96" ry="88" fill="none" stroke="#f0d9a8" stroke-width="4"/>
      <path d="M240 100 v160 M300 92 v176 M360 100 v160" stroke="#f0d9a8" stroke-width="4" opacity=".8"/>
      <rect x="272" y="76" width="56" height="18" rx="4" fill="#c98a2d"/>
      <rect x="272" y="266" width="56" height="18" rx="4" fill="#c98a2d"/>
      <line x1="300" y1="284" x2="300" y2="340" stroke="#c98a2d" stroke-width="5"/>
      <text x="300" y="204" font-size="64" text-anchor="middle" fill="#f7e8c9" font-family="KaiTi, STKaiti, serif">缘</text>`
  } else if (motif === 'pagoda') {
    body = `<circle cx="130" cy="110" r="52" fill="#f7e8c9" opacity=".85"/>
      <g fill="#1c0f0c" opacity=".68">
      <path d="M300 96 l10 26 h-20 Z"/><rect x="294" y="120" width="12" height="30"/>
      <path d="M228 168 h144 l-24 -22 h-96 Z"/><rect x="252" y="168" width="96" height="44"/>
      <path d="M208 232 h184 l-28 -24 h-128 Z"/><rect x="240" y="232" width="120" height="52"/>
      <path d="M186 304 h228 l-32 -24 h-164 Z"/><rect x="228" y="304" width="144" height="96"/></g>`
  } else if (motif === 'lake') {
    body = `<circle cx="468" cy="96" r="50" fill="#f7e8c9" opacity=".9"/>
      <path d="M40 316 q130 -96 260 0" stroke="#2a1512" stroke-width="10" fill="none" opacity=".7"/>
      <path d="M60 316 h240" stroke="#2a1512" stroke-width="6" opacity=".55"/>
      <path d="M100 292 v24 M150 274 v42 M200 268 v48 M250 274 v42" stroke="#2a1512" stroke-width="5" opacity=".55"/>
      <path d="M372 330 q46 24 92 0 l-14 22 h-64 Z" fill="#1c0f0c" opacity=".75"/>
      <path d="M418 330 v-46 l26 40 Z" fill="#f7e8c9" opacity=".75"/>
      <path d="M60 366 h90 M210 376 h120 M420 368 h110" stroke="#f7e8c9" stroke-width="4" opacity=".4"/>`
  } else if (motif === 'board') {
    body = `<rect x="130" y="110" width="340" height="210" rx="10" fill="#d9a05b"/>
      <path d="M170 140 v150 M235 140 v150 M300 140 v150 M365 140 v150 M430 140 v150 M150 165 h300 M150 215 h300 M150 265 h300" stroke="#6b4a1f" stroke-width="3" opacity=".8"/>
      <circle cx="235" cy="165" r="15" fill="#1c0f0c"/><circle cx="300" cy="215" r="15" fill="#1c0f0c"/><circle cx="365" cy="165" r="15" fill="#f7e8c9"/><circle cx="300" cy="165" r="15" fill="#f7e8c9" stroke="#6b4a1f" stroke-width="2"/><circle cx="235" cy="265" r="15" fill="#f7e8c9" stroke="#6b4a1f" stroke-width="2"/>
      <ellipse cx="90" cy="330" rx="42" ry="26" fill="#2a1512" opacity=".7"/><ellipse cx="510" cy="330" rx="42" ry="26" fill="#8a6134"/>`
  } else if (motif === 'museum') {
    body = `<path d="M300 40 L180 400 h240 Z" fill="#f7e8c9" opacity=".12"/>
      <rect x="252" y="120" width="18" height="34" rx="6" fill="#3f5d54"/><rect x="330" y="120" width="18" height="34" rx="6" fill="#3f5d54"/>
      <path d="M216 152 h168 v76 q0 44 -84 44 q-84 0 -84 -44 Z" fill="#3f5d54"/>
      <path d="M232 176 h136 M232 196 h136" stroke="#f0d9a8" stroke-width="4" opacity=".6"/>
      <circle cx="300" cy="204" r="14" fill="#f0d9a8" opacity=".6"/>
      <path d="M244 270 l-10 62 M356 270 l10 62 M300 274 v60" stroke="#3f5d54" stroke-width="14"/>
      <rect x="180" y="340" width="240" height="18" rx="6" fill="#2a1512" opacity=".7"/>`
  } else {
    body = `<path d="M60 400 C160 260 240 220 420 150" stroke="#2a1512" stroke-width="10" fill="none" opacity=".7"/>
      <g fill="#e8b7c0"><circle cx="180" cy="268" r="17"/><circle cx="250" cy="228" r="15"/><circle cx="330" cy="196" r="17"/>
      <circle cx="402" cy="162" r="14"/><circle cx="140" cy="316" r="14"/></g>
      <g fill="#c98a2d"><circle cx="180" cy="268" r="6"/><circle cx="330" cy="196" r="6"/></g>
      <circle cx="470" cy="90" r="46" fill="#f7e8c9" opacity=".8"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="600" height="400" fill="url(#g)"/>
  ${body}
  <rect x="14" y="14" width="572" height="372" fill="none" stroke="#f0d9a8" stroke-opacity=".45" stroke-width="2"/>
</svg>`
  return enc(svg)
}
