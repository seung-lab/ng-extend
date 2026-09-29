/**
 * One example of each MEC cell type, the cells shown on connectome.quest/mec
 * ("Meet the cells", seunglabdata assets/mec/gallery/cells.json), coloured
 * with the same palette (tools/mec_palette.json). Opened from the Cell
 * Library's "cell types" link on MEC (Ames 2026-09-29).
 *
 * All seven roots were current in pni_mec on 2026-09-29. Pyramidal, bipolar
 * and microglia also show their nucleus (a separate segment in MEC) in the
 * cell's colour. Each type has a one-point annotation layer, so the layer
 * bar reads as a legend. Shareable copy of the same view:
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
      "objectAlpha": 1
    },
    {
      "type": "annotation",
      "name": "Stellate",
      "source": "local://annotations",
      "annotations": [
        {
          "type": "point",
          "id": "t-stellate",
          "point": [
            142606,
            130606,
            5091
          ],
          "description": "Stellate (720575947520731264)"
        }
      ],
      "annotationColor": "#67f5cb"
    },
    {
      "type": "annotation",
      "name": "Pyramidal",
      "source": "local://annotations",
      "annotations": [
        {
          "type": "point",
          "id": "t-pyramidal",
          "point": [
            156431,
            128281,
            5398
          ],
          "description": "Pyramidal (720575947422955241)"
        }
      ],
      "annotationColor": "#3e96f0"
    },
    {
      "type": "annotation",
      "name": "Inhibitory interneuron",
      "source": "local://annotations",
      "annotations": [
        {
          "type": "point",
          "id": "t-inhibitory",
          "point": [
            118319,
            131969,
            4964
          ],
          "description": "Inhibitory interneuron (720575947567168828)"
        }
      ],
      "annotationColor": "#ff5fb0"
    },
    {
      "type": "annotation",
      "name": "Bipolar",
      "source": "local://annotations",
      "annotations": [
        {
          "type": "point",
          "id": "t-bipolar",
          "point": [
            190769,
            140962,
            5900
          ],
          "description": "Bipolar (720575947496304424)"
        }
      ],
      "annotationColor": "#f5b84a"
    },
    {
      "type": "annotation",
      "name": "Astrocyte",
      "source": "local://annotations",
      "annotations": [
        {
          "type": "point",
          "id": "t-astrocyte",
          "point": [
            158086,
            133194,
            4909
          ],
          "description": "Astrocyte (720575947505391325)"
        }
      ],
      "annotationColor": "#b06fe0"
    },
    {
      "type": "annotation",
      "name": "Oligodendrocyte",
      "source": "local://annotations",
      "annotations": [
        {
          "type": "point",
          "id": "t-oligodendrocyte",
          "point": [
            128137,
            130562,
            4213
          ],
          "description": "Oligodendrocyte (720575947480485108)"
        }
      ],
      "annotationColor": "#3fd8ff"
    },
    {
      "type": "annotation",
      "name": "Microglia",
      "source": "local://annotations",
      "annotations": [
        {
          "type": "point",
          "id": "t-microglia",
          "point": [
            131562,
            128894,
            8191
          ],
          "description": "Microglia (720575947495909088)"
        }
      ],
      "annotationColor": "#e8823c"
    }
  ],
  "selectedLayer": {
    "layer": "pni_mec",
    "visible": false
  },
  "showSlices": false
};
