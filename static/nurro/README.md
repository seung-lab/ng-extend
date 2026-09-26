# Nurro

Nurro is EyeWire II's mascot: a cream cat in a grid-textured neuron harness.
This folder is the library. Use the web copy (`static/nurro/<name>`) in the
app and in notifications; `originals/` holds the full-resolution art for print,
slides and new crops. The celebration, dance and success art below the table
was here before this catalog.

Notifications load images by URL, so point them at
`https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/nurro/<file>`.
App code imports them (`import x from '../../static/nurro/<file>'`).

## Library

| web copy | original | what it shows | used for / good for |
|---|---|---|---|
| `nurro-cape-card.png` | `originals/nurro-cape.png` | Super Nurro, red cape, flying | **In use:** the reporter's "🎉 Fixed!" notification |
| `nurro-super-v2.png` | `originals/nurro-super-v2.png` | Super Nurro, second pose | **In use:** the admins' "🎉 Fixed!" notification |
| `nurro-3d-card.jpg` | `originals/nurro-3d.webp` | 3D fluffy Nurro in a space suit with a jetpack | **In use:** "🛠️ Your report is being worked on". For fun anywhere |
| `nurro-thank-you-science.jpg` | `originals/nurro-thank-you-science.png` | "THANK YOU!" in neon neuron branches, three Nurros, "for science! ♥ Eyewire" | **In use:** "💙 Thank you, for science!" after a person's third edit. The original's handwriting is a transparent cut-out, so it needs a white backdrop (the web copy has one) |
| `nurro-confetti-card.png` | `nurro-confetti.png` | Nurro with a party popper; the streamers are neurons | Celebrations: completing a tutorial, a milestone, a badge |
| `nurro-popcorn-card.png` | `nurro-popcorn.png` | Nurro eating popcorn | "The show heats up": leaderboard races, live events, watching a replay |
| `nurro-microscope.png` | `originals/nurro-microscope.png` | Science Nurro at a desk with a microscope and laptop | Explaining the science, "how we know", research updates |
| `nurro-wheres.png` | `originals/nurro-wheres.png` | Nurro tangled in a big brain map, struggling to read it | Confusion or help states: an empty search, "lost?", onboarding a hard step |
| `nurro-inspector.png` | `originals/nurro-inspector.png` | Inspector Nurro with a magnifier inside a glowing neuron | Proofreading, spotting errors, "look closer" tutorial steps |
| `nurro-laser-teach.png` | `originals/nurro-laser-teach.png` | Nurro with a laser pointer | Teaching: tutorial steps that point at the interface |
| `nurro-original.png` | `originals/nurro-original.png` | The original Nurro | Brand, about pages, the default avatar |

Also here from before: `nurro-celebrate*.png`, `nurro-dance.png`,
`nurro-success.png`, `nurro-trophy.png`, `nurro-experiment.png`,
`nurro-at-home.png`.

## Adding one

Keep the original in `originals/`, make a web copy of at most 640 px on the
long side (transparent PNG if the art has no background, else JPEG), and add a
row above saying what it shows and what it is for.
