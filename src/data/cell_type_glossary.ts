/**
 * Plain-English expansions for the abbreviations in cell type labels, shown
 * when you hover a labelled cell (Ames 2026-09-29: "hover tips to write out
 * acronyms"). Keys are matched as whole words, case-sensitively.
 *
 * Only well-established names are listed. Retina ganglion cell names follow
 * the mouse RGC literature (e.g. Bae et al. 2018, the EyeWire museum; Jacoby
 * & Schwartz 2017 for HD1/HD2/UHD). An unknown abbreviation simply gets no
 * expansion: better silent than wrong. Add more here.
 */
export const CELL_TYPE_GLOSSARY: Record<string, string> = {
  // Broad classes
  RGC: 'retinal ganglion cell',
  AC: 'amacrine cell',
  dAC: 'displaced amacrine cell',
  SAC: 'starburst amacrine cell',
  WFAC: 'wide-field amacrine cell',
  MFAC: 'medium-field amacrine cell',
  WF: 'wide-field',
  MF: 'medium-field',
  OPC: 'oligodendrocyte precursor cell',
  // Named amacrine types
  AII: 'AII amacrine cell',
  A17: 'A17 amacrine cell',
  nNOS: 'expresses neuronal nitric oxide synthase',
  SAD: 'separate axons and dendrites',
  // Ganglion cell types and their parts
  OODS: 'ON-OFF direction-selective ganglion cell',
  DS: 'direction-selective',
  OS: 'orientation-selective',
  vOS: 'vertical orientation-selective',
  OFFvOS: 'OFF vertical orientation-selective',
  JAMB: 'J-RGC, marked by the JAM-B gene',
  JamB: 'J-RGC, marked by the JAM-B gene',
  HD1: 'high-definition ganglion cell, type 1',
  HD2: 'high-definition ganglion cell, type 2',
  UHD: 'ultra-high-definition ganglion cell',
  PixON: 'pixel-detector ON ganglion cell',
  Fmini: 'F-mini ganglion cell (Foxp2 family)',
  SmRF: 'small receptive field',
  MeRF: 'medium receptive field',
  'tr.': 'transient',
  trans: 'transient',
  sus: 'sustained',
  Hb9: 'Hb9-expressing (an ON-OFF direction-selective type)',
  HB9: 'Hb9-expressing (an ON-OFF direction-selective type)',
  M1: 'melanopsin ganglion cell (ipRGC), type M1',
  M2: 'melanopsin ganglion cell (ipRGC), type M2',
  M3: 'melanopsin ganglion cell (ipRGC), type M3',
  M4: 'melanopsin ganglion cell (ipRGC), type M4',
  M5: 'melanopsin ganglion cell (ipRGC), type M5',
  M6: 'melanopsin ganglion cell (ipRGC), type M6',
  ipRGC: 'intrinsically photosensitive retinal ganglion cell',
  EW: 'EyeWire (a type named in the EyeWire museum)',
  // Cortex (MICrONS)
  IT: 'intratelencephalic',
  ET: 'extratelencephalic',
  NP: 'near-projecting',
  CT: 'corticothalamic',
  'L2/3': 'cortical layer 2/3',
  L4: 'cortical layer 4',
  L5: 'cortical layer 5',
  L6: 'cortical layer 6',
};

const KEYS = Object.keys(CELL_TYPE_GLOSSARY).sort((a, b) => b.length - a.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const TOKEN = new RegExp(`(?<![\\w/])(${KEYS.map(esc).join('|')})(?![\\w/])`, 'g');

/** "OFF tr. SmRF" -> ["tr. = transient", "SmRF = small receptive field"]. */
export function explainCellType(label: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of (label || '').matchAll(TOKEN)) {
    const k = m[1];
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(`${k} = ${CELL_TYPE_GLOSSARY[k]}`);
  }
  return out;
}
