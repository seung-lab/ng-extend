/**
 * One example of each MEC cell type, the cells shown on connectome.quest/mec
 * ("Meet the cells", seunglabdata assets/mec/gallery/cells.json), coloured
 * with the same palette (tools/mec_palette.json). Opened from the Cell
 * Library's "cell types" link on MEC (Ames 2026-09-29).
 *
 * All seven roots were current in pni_mec on 2026-09-29. Pyramidal, bipolar
 * and microglia also show their nucleus (a separate segment in MEC) in the
 * cell's colour. The Seg tab of the segment layer's side panel is the key: each
 * cell's type label (from the MEC log) shows in place of its ID there. Shareable copy of the same view:
 * #!middleauth+https://global.daf-apis.com/nglstate/api/v1/5321956363075584
 */
export const MEC_CELL_TYPES_STATE: Record<string, any> = {
  "dimensions": {
    "x": [
      1.6e-08,
      "m"
    ],
    "y": [
      1.6e-08,
      "m"
    ],
    "z": [
      4.5e-08,
      "m"
    ]
  },
  "position": [
    154544.0,
    134621.5,
    5091
  ],
  "crossSectionScale": 1.2,
  "projectionScale": 130000,
  "projectionOrientation": [
    0.8547285795211792,
    0.020196104422211647,
    -0.06204566732048988,
    -0.5149577260017395
  ],
  "layout": "xy-3d",
  "layers": [
    {
      "type": "image",
      "source": "precomputed://https://c10s.pni.princeton.edu/mec_alignment_2025-09/alignment/img/v2",
      "name": "img",
      "shader": "#uicontrol float black slider(min=0, max=1, default=0.0)\n#uicontrol float white slider(min=0, max=1, default=1.0)\nfloat rescale(float value) {\n  return (value - black) / (white - black);\n}\nvoid main() {\n  float val = toNormalized(getDataValue());\n  if (val < black) {\n    emitRGB(vec3(0,0,0));\n  } else if (val > white) {\n    emitRGB(vec3(1.0, 1.0, 1.0));\n  } else {\n    emitGrayscale(rescale(val));\n  }\n}\n"
    },
    {
      "type": "segmentation",
      "name": "pni_mec",
      "source": {
        "url": "graphene://middleauth+https://hc.himc-cave.com/segmentation/table/pni_mec",
        "subsources": {
          "default": true,
          "mesh": true,
          "graph": true
        },
        "enableDefaultSubsources": true
      },
      "segments": [
        "720575947520731264",
        "720575947422955241",
        "720575947193326845",
        "720575947567168828",
        "720575947496304424",
        "720575947357938785",
        "720575947505391325",
        "720575947480485108",
        "720575947495909088",
        "720575947364826821"
      ],
      "segmentColors": {
        "720575947520731264": "#67f5cb",
        "720575947422955241": "#3e96f0",
        "720575947193326845": "#3e96f0",
        "720575947567168828": "#ff5fb0",
        "720575947496304424": "#f5b84a",
        "720575947357938785": "#f5b84a",
        "720575947505391325": "#b06fe0",
        "720575947480485108": "#3fd8ff",
        "720575947495909088": "#e8823c",
        "720575947364826821": "#e8823c"
      },
      "selectedAlpha": 0.35,
      "notSelectedAlpha": 0,
      "objectAlpha": 1,
      "tab": "segments"
    }
  ],
  "selectedLayer": {
    "layer": "pni_mec",
    "visible": true,
    "size": 340
  },
  "showSlices": false
};
