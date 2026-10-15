"""Write src/annotation_quest_examples.ts from the lab's own data, so that no
coordinate or sentence in it is typed by hand.

Reads the lab's cilia status reference sheet (Status, When to use, Example;
anyone with the link can read it) and the neuroglancer views its Example
column links to.

Where a view lives decides how it is read:

  * On the CAVE state server (global.daf-apis.com): fetched with the CAVE
    token already on this machine (~/.cloudvolume/secrets/cave-secret.json),
    read only. The token is sent to that server alone and is never printed
    or written anywhere.
  * On Pyr's state server (global.brain-wire-test.org), where a Pyr share
    link keeps its view: it answers only a signed in player, and this script
    has no Pyr sign in and does not borrow one. Someone signed in can save
    the view beside the other downloads as state-<id>.json (open the link,
    then in the browser console: copy(JSON.stringify(viewer.state.toJSON())))
    and the script will use it.
  * Neither: the lab's ORIGINAL view of the same status is used (below), and
    the script says so. On 2026-10-13 the lab re-saved its three examples as
    Pyr share links; the originals are the same three statuses on the CAVE
    state server.

Run it again when the lab changes the sheet or adds an example:

    python -I scripts/make-quest-examples.py <a folder for the downloads>

The downloads are kept in that folder (ref.xlsx, state-<id>.json) and are
reused if they are already there; delete them to fetch again. Keep the folder
outside the repository: the downloads are the lab's, not ours to commit.
"""
import html, io, json, os, re, sys, urllib.error, urllib.request, zipfile

SHEET = '1RPoLl36rx6nl17NTqVsvcC5FBo-wgDmkvszv0sfYigU'
# The one server the CAVE token is ever sent to.
CAVE_STATES = 'https://global.daf-apis.com/nglstate/api/v1/'
# The lab's first examples (the sheet's Example column as read 2026-10-13,
# before it was re-pointed at Pyr share links).
ORIGINALS = {
    'Cilium annotated': CAVE_STATES + '6292320998653952',
    'No cilium (BB & DC clear)': CAVE_STATES + '6390751482085376',
    'No cilium (BB & DC unclear; internal centriole pair)': CAVE_STATES + '5522129563418624',
}
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'src', 'annotation_quest_examples.ts')

if len(sys.argv) != 2:
    sys.exit(__doc__)
DATA = os.path.abspath(sys.argv[1])
if os.path.commonpath([DATA, REPO]) == REPO:
    sys.exit('Keep the downloads outside the repository.')
os.makedirs(DATA, exist_ok=True)

# ── the reference sheet: Status | When to use | Example ────────────────────
xlsx = os.path.join(DATA, 'ref.xlsx')
if not os.path.exists(xlsx):
    with urllib.request.urlopen('https://docs.google.com/spreadsheets/d/%s/export?format=xlsx' % SHEET, timeout=60) as r:
        io.open(xlsx, 'wb').write(r.read())
z = zipfile.ZipFile(xlsx)
ss = []
for si in re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode('utf-8'), re.S):
    ss.append(html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))))
x = z.read('xl/worksheets/sheet1.xml').decode('utf-8')
rows = []
for row in re.findall(r'<row [^>]*>(.*?)</row>', x, re.S):
    cells = {}
    for m in re.finditer(r'<c ([^>]*?)(?:/>|>(.*?)</c>)', row, re.S):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        v = re.search(r'<v>(.*?)</v>', m.group(2) or '', re.S)
        if a.get('t') == 's' and v:
            cells[re.match(r'[A-Z]+', a['r']).group(0)] = ss[int(v.group(1))].strip()
    rows.append(cells)
assert rows[0].get('A') == 'Status' and rows[0].get('B') == 'When to use' and rows[0].get('C') == 'Example', rows[0]
guide = [(r['A'], r['B'], r.get('C', '')) for r in rows[1:] if r.get('A')]
assert guide, 'the sheet has no statuses'

# Wording the lab has corrected but the sheet does not carry yet. Each entry
# names who gave it and when; drop it once the sheet says the same, so the
# sheet stays the one source. The script says so when one is no longer needed.
WHEN_TO_USE_CORRECTIONS = {
    # Celia, Slack 2026-10-15.
    'No cilium (BB & DC clear)': 'No cilium, but centrioles are visible and clearly differentiated (basal body closer to the surface).',
}
for i, (status, when, example) in enumerate(guide):
    if status in WHEN_TO_USE_CORRECTIONS:
        if when == WHEN_TO_USE_CORRECTIONS[status]:
            print('The sheet now says this itself; remove its correction:', status, file=sys.stderr)
        guide[i] = (status, WHEN_TO_USE_CORRECTIONS[status], example)


# ── the example views ─────────────────────────────────────────────────────
def state_url(link):
    """The view a link opens: the state server address after the '#!'."""
    m = re.search(r'#!(?:middleauth\+)?(https://[^/\s]+/nglstate/api/v1/\d+)\s*$', link or '')
    return m.group(1) if m else None


def saved(url):
    return os.path.join(DATA, 'state-%s.json' % url.rsplit('/', 1)[1])


def read_state(url):
    """The view at a state server address, or None when it cannot be read here."""
    path = saved(url)
    if not os.path.exists(path):
        if not url.startswith(CAVE_STATES):
            return None  # not the CAVE server: the token is not sent, nothing is fetched
        secret = json.load(open(os.path.expanduser('~/.cloudvolume/secrets/cave-secret.json'), encoding='utf-8'))
        token = secret.get('token') if isinstance(secret, dict) else None
        if not token:
            sys.exit('no token in the CAVE secret file')
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
        except urllib.error.HTTPError as e:
            sys.exit('the state server answered %d for %s' % (e.code, url))
        io.open(path, 'wb').write(body)
    try:
        return json.load(open(path, encoding='utf-8'))
    except ValueError:
        sys.exit('%s is not a saved view (not JSON)' % path)


def layer(st, pattern):
    hits = [l for l in st['layers'] if l.get('type') == 'annotation' and not l.get('archived') and re.search(pattern, l['name'], re.I)]
    assert len(hits) == 1, (pattern, [l['name'] for l in st['layers']])
    return hits[0]


examples = []
notes = []
for status, when, link in guide:
    url = state_url(link)
    if link and not url:
        sys.exit('the Example for "%s" is not a link to a saved view: %s' % (status, link))
    if not url:
        continue
    st = read_state(url)
    if st is None:
        original = ORIGINALS.get(status)
        if not original:
            sys.exit('The example for "%s" is at %s, which needs a Pyr sign in, and there is no original to fall back on. Save the view as %s (see the top of this script).' % (status, url, saved(url)))
        notes.append('"%s": the sheet links %s, which needs a Pyr sign in; the lab\'s original view %s is used' % (status, url, original))
        url = original
        st = read_state(url)
    seg = [l for l in st['layers'] if l.get('type', '').startswith('segmentation') and not l.get('archived')]
    assert len(seg) == 1 and len(seg[0]['segments']) == 1, [(l.get('name'), l.get('source')) for l in seg]
    source = seg[0].get('source')
    assert 'stroeh_mouse_retina' in json.dumps(source), ('not a view of the retina', source)
    bb, dc, cc = layer(st, r'basal'), layer(st, r'centriole'), layer(st, r'cent(er|re)line')
    assert len(bb['annotations']) == 1 and bb['annotations'][0]['type'] == 'point'
    assert len(dc['annotations']) == 1 and dc['annotations'][0]['type'] == 'point'
    assert len(cc['annotations']) <= 1 and all(a['type'] == 'polyline' for a in cc['annotations'])
    assert st['dimensions'] == {'x': [1.6e-08, 'm'], 'y': [1.6e-08, 'm'], 'z': [4e-08, 'm']}, st['dimensions']
    examples.append({
        'status': status, 'source': url, 'root': str(seg[0]['segments'][0]).lstrip('!'),
        'position': st['position'], 'crossSectionScale': st['crossSectionScale'],
        'projectionScale': st['projectionScale'], 'projectionOrientation': st.get('projectionOrientation'),
        'basalBody': bb['annotations'][0]['point'], 'daughterCentriole': dc['annotations'][0]['point'],
        'centerline': cc['annotations'][0]['points'] if cc['annotations'] else None,
        # as the lab's first views name them; a view saved from Pyr may capitalise differently
        'layerNames': [cc['name'], dc['name'], bb['name']],
    })
assert examples, 'the sheet links no example views'
names = examples[0]['layerNames']
assert all(e['layerNames'] == names for e in examples), [e['layerNames'] for e in examples]


def ts(v):
    return json.dumps(v, ensure_ascii=False)


HEAD = '''/**
 * The lab's guide to the cilium statuses, and its real examples.
 *
 * GENERATED by scripts/make-quest-examples.py from the lab's own data, so
 * that no number or sentence here was typed by hand: the reference sheet
 * (Status, When to use, Example; @SHEET@) and the
 * lab's saved view of each example (each one's `source`). Do not edit it; run
 * the script again. Nothing here is made up: a status the sheet gives no
 * example for has none.
 *
 * Two uses. The Submit form shows the lab's "when to use" line for the status
 * chosen. And "Here's a reference" in the Instructions opens one view, in a
 * new tab, holding the example cells with the lab's own annotations in the
 * quest's three layers; each basal body carries its status and when to use
 * it as its description, so that layer's list is the index: the arrows over
 * the list step from one example to the next, and a row's jump button goes
 * to that one. The cells are named by the ids the lab's views carry; an edit
 * to one later leaves the example showing the cell as the lab annotated it
 * (Ames 2026-10-13: "a ng link that has layers/annotations and descriptions
 * to demo the various things on real cell with real example annotations").
 */
import { findDatasetByCanonical } from './datasets';

/** When to use each status, in the lab's words (the sheet's column B). */
export const QUEST_STATUS_GUIDE: Record<string, string> = {
'''.replace('@SHEET@', SHEET)

TYPES = '''};

/** The layers as the lab's own views name them, in the lab's order. */
export const QUEST_EXAMPLE_LAYERS = {
  centerline: @CC@,
  daughterCentriole: @DC@,
  basalBody: @BB@,
};

export interface QuestExample {
  status: string;
  /** The lab's saved view this came from. */
  source: string;
  /** The cell, as the lab's view names it. */
  root: string;
  position: number[];
  crossSectionScale: number;
  projectionScale: number;
  projectionOrientation?: number[];
  basalBody: number[];
  daughterCentriole: number[];
  /** The cilium centerline, a polyline; absent where the lab drew none. */
  centerline?: number[][];
}

export const QUEST_EXAMPLES: QuestExample[] = [
'''.replace('@CC@', ts(names[0])).replace('@DC@', ts(names[1])).replace('@BB@', ts(names[2]))

TAIL = '''];

/** The colour key: centerline green, daughter centriole red, basal body gold. */
const COLORS = { centerline: '#7CFFB2', daughterCentriole: '#e06060', basalBody: '#f5d142' };

/** The view of the examples, as a neuroglancer state. */
export function questExamplesState(): any {
  const dataset = findDatasetByCanonical('stroeh_mouse_retina');
  const first = QUEST_EXAMPLES[0];
  const base = (dataset?.layers ?? []).map((l: any) =>
      typeof l?.type === 'string' && l.type.startsWith('segmentation') ?
          { ...l, segments: QUEST_EXAMPLES.map(e => e.root) } :
          { ...l });
  const says = (e: QuestExample) => `Example: ${e.status}. ${QUEST_STATUS_GUIDE[e.status] || ''}`.trim();
  const annotationLayer = (name: string, color: string, tool: string, annotations: any[]) =>
      ({ type: 'annotation', source: 'local://annotations', tab: 'annotations', name, annotationColor: color, tool, annotations });
  return {
    dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] },
    position: first.position,
    crossSectionScale: first.crossSectionScale,
    projectionScale: first.projectionScale,
    ...(first.projectionOrientation ? { projectionOrientation: first.projectionOrientation } : {}),
    layout: 'xy-3d',
    layers: [
      ...base,
      annotationLayer(QUEST_EXAMPLE_LAYERS.centerline, COLORS.centerline, 'annotatePolyline',
          QUEST_EXAMPLES.filter(e => e.centerline).map((e, i) => ({
            type: 'polyline', id: `example-centerline-${i + 1}`, points: e.centerline,
            description: `Example: ${e.status}. The cilium centerline.`,
          }))),
      annotationLayer(QUEST_EXAMPLE_LAYERS.daughterCentriole, COLORS.daughterCentriole, 'annotatePoint',
          QUEST_EXAMPLES.map((e, i) => ({
            type: 'point', id: `example-daughter-centriole-${i + 1}`, point: e.daughterCentriole,
            description: `Example: ${e.status}. The daughter centriole.`,
          }))),
      // The basal bodies carry each status and when to use it: this layer's
      // list is the index of the examples.
      annotationLayer(QUEST_EXAMPLE_LAYERS.basalBody, COLORS.basalBody, 'annotatePoint',
          QUEST_EXAMPLES.map((e, i) => ({
            type: 'point', id: `example-basal-body-${i + 1}`, point: e.basalBody, description: says(e),
          }))),
    ],
    selectedLayer: { layer: QUEST_EXAMPLE_LAYERS.basalBody, visible: true },
  };
}

/** The examples view as a link to this site. */
export function questExamplesUrl(): string {
  return `${window.location.origin}${window.location.pathname}#!${encodeURIComponent(JSON.stringify(questExamplesState()))}`;
}

/** Open the examples in a new tab, so the view in hand, and any annotations
 *  being placed in it, stay as they are. */
export function openQuestExamples(): void {
  window.open(questExamplesUrl(), '_blank', 'noopener');
}
'''

out = io.StringIO()
w = out.write
w(HEAD)
for status, when, _ in guide:
    w('  %s: %s,\n' % (ts(status), ts(when)))
w(TYPES)
for e in examples:
    w('  {\n')
    w('    status: %s,\n    source: %s,\n    root: %s,\n' % (ts(e['status']), ts(e['source']), ts(e['root'])))
    w('    position: %s,\n    crossSectionScale: %s,\n    projectionScale: %s,\n' % (ts(e['position']), ts(e['crossSectionScale']), ts(e['projectionScale'])))
    if e['projectionOrientation'] is not None:
        w('    projectionOrientation: %s,\n' % ts(e['projectionOrientation']))
    w('    basalBody: %s,\n    daughterCentriole: %s,\n' % (ts(e['basalBody']), ts(e['daughterCentriole'])))
    if e['centerline'] is not None:
        w('    centerline: [\n')
        for p in e['centerline']:
            w('      %s,\n' % ts(p))
        w('    ],\n')
    w('  },\n')
w(TAIL)
io.open(OUT, 'w', encoding='utf-8', newline='\n').write(out.getvalue())
print('wrote', OUT)
print('statuses:', [g[0] for g in guide])
print('examples:', [(e['status'], e['root'], 'centerline %d points' % len(e['centerline']) if e['centerline'] else 'no centerline') for e in examples])
print('lab layer names:', names)
for n in notes:
    print('NOTE', n)
