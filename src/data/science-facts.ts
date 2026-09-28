/**
 * "Did you know?" facts for Your Week in Science. One is shown per ISO week.
 *
 * The first four are the original pool (kept as they were). The rest come from
 * the verified set Amy supplied on 2026-09-28; three that repeated the originals
 * (ew2-neuro-001, 014, 015) were skipped. Only `text` is shown; source,
 * evidence and note are kept so every claim can be traced to its citation.
 */
export interface ScienceFact {
  id: string;
  text: string;
  category?: string;
  /** Key into SCIENCE_FACT_SOURCES. */
  source?: string;
  evidence?: 'published' | 'preprint' | string;
  note?: string;
}

export const SCIENCE_FACTS: ScienceFact[] = [
  { id: 'ew2-original-1', text: 'Each neuron you trace may connect to thousands of others. Mapping even one cell helps scientists understand entire circuits.' },
  { id: 'ew2-original-2', text: 'The MICrONS dataset contains roughly 200,000 neurons and 500 million synapses from a cubic millimeter of mouse cortex.' },
  { id: 'ew2-original-3', text: 'Neuron tracing data from citizen scientists has contributed to peer-reviewed discoveries about how the eye processes motion.' },
  { id: 'ew2-original-4', text: 'Thanks to projects like EyeWire and FlyWire, the first complete wiring diagram of a fruit fly brain, 140,000 neurons, now exists.' },
  {"id": "ew2-neuro-002", "text": "One tiny fly brain contains over 50 million mapped synapses.", "category": "connectomics", "source": "fly", "evidence": "published"},
  {"id": "ew2-neuro-003", "text": "FlyWire traced about 149 meters of neural wiring inside one fly brain.", "category": "connectomics", "source": "fly", "evidence": "published"},
  {"id": "ew2-neuro-004", "text": "One pair of FlyWire neurons connects through more than 2,400 synapses.", "category": "connectomics", "source": "fly", "evidence": "published"},
  {"id": "ew2-neuro-005", "text": "One FlyWire neuron connects outward to over 6,000 other neurons.", "category": "connectomics", "source": "fly", "evidence": "published", "note": "CT1 has 6,399 postsynaptic partners in the thresholded connectivity analysis."},
  {"id": "ew2-neuro-006", "text": "FlyWire's human proofreading added up to roughly 33 person-years.", "category": "connectomics", "source": "fly", "evidence": "published"},
  {"id": "ew2-neuro-007", "text": "FlyWire's 2024 atlas distinguished 8,453 neuron types.", "category": "connectomics", "source": "flytypes", "evidence": "published"},
  {"id": "ew2-neuro-008", "text": "FlyWire's 2024 atlas proposed 4,581 previously unrecognized neuron types.", "category": "connectomics", "source": "flytypes", "evidence": "published"},
  {"id": "ew2-neuro-009", "text": "About 30% of neurons in one fly connectome belonged to a highly interconnected club.", "category": "connectomics", "source": "flynetwork", "evidence": "published", "note": "Network-analysis rich club, not a universal percentage for all fly brains."},
  {"id": "ew2-neuro-010", "text": "BANC reconstructed a fly's brain and nerve cord from 7,010 microscopic slices.", "category": "connectomics", "source": "banc", "evidence": "published"},
  {"id": "ew2-neuro-011", "text": "BANC's 2026 brain-and-cord map took a team of 155 proofreaders.", "category": "connectomics", "source": "banc", "evidence": "published"},
  {"id": "ew2-neuro-012", "text": "About 1,300 neurons carry signals from a fruit fly's brain down to its nerve cord.", "category": "connectomics", "source": "banc", "evidence": "published"},
  {"id": "ew2-neuro-013", "text": "About 1,800 neurons carry signals from a fruit fly's nerve cord up to its brain.", "category": "connectomics", "source": "banc", "evidence": "published"},
  {"id": "ew2-neuro-016", "text": "MICrONS recorded visual responses from roughly 75,000 neurons in one mouse.", "category": "connectomics", "source": "microns", "evidence": "published"},
  {"id": "ew2-neuro-017", "text": "MICrONS links wiring and activity across 4 mouse visual areas.", "category": "connectomics", "source": "microns", "evidence": "published"},
  {"id": "ew2-neuro-018", "text": "Imaging the MICrONS brain sample took 6 months of continuous electron microscopy.", "category": "connectomics", "source": "microns", "evidence": "published"},
  {"id": "ew2-neuro-019", "text": "One cubic millimeter of mapped human cortex contained about 57,000 cells.", "category": "connectomics", "source": "humanmap", "evidence": "published", "note": "One surgically removed temporal-cortex sample; cells include neurons and glia."},
  {"id": "ew2-neuro-020", "text": "One cubic millimeter of mapped human cortex contained about 150 million synapses.", "category": "connectomics", "source": "humanmap", "evidence": "published"},
  {"id": "ew2-neuro-021", "text": "One cubic millimeter of mapped human cortex held about 23 centimeters of blood vessels.", "category": "connectomics", "source": "humanmap", "evidence": "published"},
  {"id": "ew2-neuro-022", "text": "A detailed map of one cubic millimeter of human cortex required 1.4 petabytes of data.", "category": "connectomics", "source": "humanmap", "evidence": "published"},
  {"id": "ew2-neuro-023", "text": "Some human cortical neuron pairs connect through as many as 50 synapses.", "category": "connectomics", "source": "humanmap", "evidence": "published", "note": "Rare axonal inputs in the H01 sample; not the number of partners per neuron."},
  {"id": "ew2-neuro-024", "text": "An adult hermaphrodite C. elegans worm has just 302 neurons.", "category": "connectomics", "source": "worm", "evidence": "published"},
  {"id": "ew2-neuro-025", "text": "An adult male C. elegans worm has 385 neurons.", "category": "connectomics", "source": "worm", "evidence": "published"},
  {"id": "ew2-neuro-026", "text": "A fruit fly larva's mapped brain contains 3,016 neurons.", "category": "connectomics", "source": "larva", "evidence": "published"},
  {"id": "ew2-neuro-027", "text": "A fruit fly larva's brain map contains about 548,000 synapses.", "category": "connectomics", "source": "larva", "evidence": "published"},
  {"id": "ew2-neuro-028", "text": "A sea squirt larva's mapped central nervous system contains just 177 neurons.", "category": "connectomics", "source": "ciona", "evidence": "published"},
  {"id": "ew2-neuro-029", "text": "EyeWire's 2018 retinal museum reconstructed 396 ganglion-cell branching trees.", "category": "connectomics", "source": "museum", "evidence": "published"},
  {"id": "ew2-neuro-030", "text": "EyeWire's 2018 retinal museum sorted ganglion cells into 47 anatomical clusters.", "category": "connectomics", "source": "museum", "evidence": "published"},
  {"id": "ew2-neuro-031", "text": "Nearly 30,000 EyeWirers contributed to the research behind the 2018 retinal museum.", "category": "connectomics", "source": "eyewirecommunity", "evidence": "published", "note": "The project announcement credits 29,276 contributors."},
  {"id": "ew2-neuro-032", "text": "The 2026 EyeWire II preprint maps nearly 1 square millimeter of mouse retina.", "category": "connectomics", "source": "eyewire2", "evidence": "preprint"},
  {"id": "ew2-neuro-033", "text": "The 2026 EyeWire II preprint reports over 25,000 reconstructed retinal neurons.", "category": "connectomics", "source": "eyewire2", "evidence": "preprint", "note": "Sum of more than 8,000 bipolar, 13,000 amacrine and 4,000 ganglion cells; preprint snapshot."},
  {"id": "ew2-neuro-034", "text": "EyeWire II's 2026 preprint recovers all 15 known mouse bipolar-cell types.", "category": "connectomics", "source": "eyewire2", "evidence": "preprint"},
  {"id": "ew2-neuro-035", "text": "EyeWire II's 2026 preprint reported contributions from over 30 labs.", "category": "connectomics", "source": "eyewire2", "evidence": "preprint"},
  {"id": "ew2-neuro-036", "text": "A human retina contains roughly 92 million rods for detecting light.", "category": "retina-and-vision", "source": "photoreceptors", "evidence": "published"},
  {"id": "ew2-neuro-037", "text": "A human retina contains roughly 4.6 million cones for color and detailed vision.", "category": "retina-and-vision", "source": "photoreceptors", "evidence": "published"},
  {"id": "ew2-neuro-038", "text": "Your sharpest-vision region packs roughly 200,000 cones into each square millimeter.", "category": "retina-and-vision", "source": "photoreceptors", "evidence": "published", "note": "Mean peak foveal density in measured retinas, not uniform density across the entire fovea."},
  {"id": "ew2-neuro-039", "text": "The human retina's central rod-free zone is only about 0.35 millimeters across.", "category": "retina-and-vision", "source": "photoreceptors", "evidence": "published"},
  {"id": "ew2-neuro-040", "text": "Typical human color vision starts with just 3 classes of cone cells.", "category": "retina-and-vision", "source": "conemosaic", "evidence": "published"},
  {"id": "ew2-neuro-041", "text": "The retina's circuitry is built from 5 major classes of neurons.", "category": "retina-and-vision", "source": "mousecells", "evidence": "published", "note": "Photoreceptors, horizontal cells, bipolar cells, amacrine cells and ganglion cells; each class contains types."},
  {"id": "ew2-neuro-042", "text": "A 2020 atlas identified 63 types of mouse amacrine cells.", "category": "retina-and-vision", "source": "amacrines", "evidence": "published"},
  {"id": "ew2-neuro-043", "text": "A 2019 atlas identified 46 types of mouse retinal ganglion cells.", "category": "retina-and-vision", "source": "rgctypes", "evidence": "published"},
  {"id": "ew2-neuro-044", "text": "One laboratory mouse retina contains roughly 6.4 million rods.", "category": "retina-and-vision", "source": "mousecells", "evidence": "published", "note": "C57 laboratory mice studied by Jeon et al.; species and strain context matter."},
  {"id": "ew2-neuro-045", "text": "One laboratory mouse retina contains roughly 180,000 cones.", "category": "retina-and-vision", "source": "mousecells", "evidence": "published"},
  {"id": "ew2-neuro-046", "text": "One mouse retinal cell family splits into 4 groups, each preferring a different movement direction.", "category": "retina-and-vision", "source": "directions", "evidence": "published", "note": "ON-OFF direction-selective ganglion cells; not every direction-selective ganglion-cell class."},
  {"id": "ew2-neuro-047", "text": "Human retinas contain roughly 700,000 to 1.5 million ganglion cells, which send visual information toward the brain.", "category": "retina-and-vision", "source": "humanrgc", "evidence": "published"},
  {"id": "ew2-neuro-048", "text": "In darkness, people can detect a single photon slightly better than chance.", "category": "retina-and-vision", "source": "photon", "evidence": "published", "note": "Controlled 2016 experiment; not reliable single-photon perception on every trial."},
  {"id": "ew2-neuro-049", "text": "People can spot target images flashed for just 13 milliseconds in laboratory tests.", "category": "retina-and-vision", "source": "pictures", "evidence": "published", "note": "Exposure duration, not total processing time; rapid serial visual presentation task."},
  {"id": "ew2-neuro-050", "text": "In 2025, 5 volunteers saw 'olo,' an intensely saturated color produced by targeted retinal stimulation.", "category": "retina-and-vision", "source": "olo", "evidence": "published", "note": "Small experimental demonstration; not a color reproducible on ordinary screens."},
  {"id": "ew2-neuro-051", "text": "A widely cited estimate puts the human brain at about 86 billion neurons.", "category": "brains-and-cells", "source": "humanneurons", "evidence": "published", "note": "Estimate from a small adult male sample; individual brains vary."},
  {"id": "ew2-neuro-052", "text": "The human cerebral cortex contains an estimated 16 billion neurons.", "category": "brains-and-cells", "source": "humanregions", "evidence": "published"},
  {"id": "ew2-neuro-053", "text": "The human cerebellum contains an estimated 69 billion neurons.", "category": "brains-and-cells", "source": "humanregions", "evidence": "published"},
  {"id": "ew2-neuro-054", "text": "The human brain has a roughly 1:1 ratio of neurons to non-neuronal cells.", "category": "brains-and-cells", "source": "humanneurons", "evidence": "published", "note": "Azevedo et al. estimated 84.6 billion non-neuronal cells versus 86.1 billion neurons."},
  {"id": "ew2-neuro-055", "text": "Your brain uses about 20% of your resting energy while weighing roughly 2% of your body.", "category": "brains-and-cells", "source": "energy", "evidence": "published"},
  {"id": "ew2-neuro-056", "text": "Young adult brains contain an estimated 150,000 to 180,000 kilometers of myelinated nerve fibers.", "category": "brains-and-cells", "source": "whitematter", "evidence": "published", "note": "Rounded estimates at age 20 from Marner et al.; not a fixed lifetime value."},
  {"id": "ew2-neuro-057", "text": "A single rat Purkinje neuron receives roughly 175,000 synapses from parallel fibers.", "category": "brains-and-cells", "source": "purkinje", "evidence": "published", "note": "Study estimate; not a count of unique presynaptic neurons."},
  {"id": "ew2-neuro-058", "text": "A 2023 mouse-brain atlas distinguished 5,322 cell types using gene activity.", "category": "brains-and-cells", "source": "mouseatlas", "evidence": "published", "note": "Transcriptomic clusters/types under that atlas's classification; not a universal final count."},
  {"id": "ew2-neuro-059", "text": "A 2023 human-brain atlas distinguished 3,313 cell subtypes using gene activity.", "category": "brains-and-cells", "source": "humanatlas", "evidence": "published", "note": "Transcriptomic subclusters in that study."},
  {"id": "ew2-neuro-060", "text": "One African elephant brain was estimated to contain 257 billion neurons.", "category": "brains-and-cells", "source": "elephant", "evidence": "published"},
  {"id": "ew2-neuro-061", "text": "About 97.5% of neurons in one studied elephant brain were in its cerebellum.", "category": "brains-and-cells", "source": "elephant", "evidence": "published"},
  {"id": "ew2-neuro-062", "text": "Parrot and songbird brains pack about twice as many neurons as equally heavy primate brains.", "category": "brains-and-cells", "source": "birds", "evidence": "published", "note": "Average scaling comparison in sampled species; not every bird."},
  {"id": "ew2-neuro-063", "text": "Some human astrocytes occupy about 16 times the volume of their rodent counterparts.", "category": "brains-and-cells", "source": "astrocytes", "evidence": "published", "note": "Protoplasmic astrocyte domains; approximately 16.5-fold volume difference, not all astrocyte classes."},
  {"id": "ew2-neuro-064", "text": "Mouse neurons transplanted into rats survived up to 36 months.", "category": "brains-and-cells", "source": "longevity", "evidence": "published", "note": "Mouse Purkinje neurons grafted into rat embryos; not a clinical treatment claim."},
  {"id": "ew2-neuro-065", "text": "A single human astrocyte's territory can encompass an estimated 2 million synapses.", "category": "brains-and-cells", "source": "astrocytes", "evidence": "published", "note": "Upper end of domain estimate, not two million individually measured direct contacts."},
  {"id": "ew2-neuro-066", "text": "A neuron's sodium-potassium pump moves 3 sodium ions out for every 2 potassium ions brought in.", "category": "signals-senses-and-memory", "source": "pump", "evidence": "published"},
  {"id": "ew2-neuro-067", "text": "Mice learning a reaching task formed new dendritic spines within 1 hour.", "category": "signals-senses-and-memory", "source": "learning", "evidence": "published"},
  {"id": "ew2-neuro-068", "text": "In a mouse study, synaptic contact areas averaged about 18% smaller after sleep.", "category": "signals-senses-and-memory", "source": "synapsesleep", "evidence": "published", "note": "Axon-spine interface area in sampled motor and sensory cortex; not all synapses or whole-brain volume."},
  {"id": "ew2-neuro-069", "text": "Synaptic gaps in BANC's fly tissue are only about 10 to 20 nanometers wide.", "category": "signals-senses-and-memory", "source": "banc", "evidence": "published"},
  {"id": "ew2-neuro-070", "text": "Neurotransmitter-filled vesicles in BANC's fly tissue are roughly 40 nanometers across.", "category": "signals-senses-and-memory", "source": "banc", "evidence": "published"},
  {"id": "ew2-neuro-071", "text": "In zebrafish, individual myelin-making cells built new sheaths during a window of about 5 hours.", "category": "signals-senses-and-memory", "source": "myelin", "evidence": "published", "note": "Observed developmental oligodendrocytes; not a universal lifetime rule across species."},
  {"id": "ew2-neuro-072", "text": "Each human cochlea contains about 3,500 inner hair cells that help turn sound into neural signals.", "category": "signals-senses-and-memory", "source": "cochlea", "evidence": "published"},
  {"id": "ew2-neuro-073", "text": "The human cochlea usually lines up its sound-amplifying outer hair cells in 3 rows.", "category": "signals-senses-and-memory", "source": "cochlea", "evidence": "published", "note": "Occasional fourth row occurs."},
  {"id": "ew2-neuro-074", "text": "Your cochlea's sound-sensing strip spirals through roughly 35 millimeters.", "category": "signals-senses-and-memory", "source": "cochlea", "evidence": "published"},
  {"id": "ew2-neuro-075", "text": "Humans have roughly 400 potentially functional odor-receptor genes.", "category": "signals-senses-and-memory", "source": "smellgenes", "evidence": "published"},
  {"id": "ew2-neuro-076", "text": "People distinguished odor sequences with smells starting just 60 milliseconds apart.", "category": "signals-senses-and-memory", "source": "smelltiming", "evidence": "published", "note": "Reversed-order sequences with 60-ms onset asynchrony; not detection of an isolated 60-ms odor pulse."},
  {"id": "ew2-neuro-077", "text": "Mice have about 2.7 times as many functional odor-receptor genes as humans.", "category": "signals-senses-and-memory", "source": "smellevolution", "evidence": "published"},
  {"id": "ew2-neuro-078", "text": "A classic estimate puts working-memory capacity at about 4 chunks of information.", "category": "signals-senses-and-memory", "source": "memorycapacity", "evidence": "published", "note": "Task-dependent estimate under conditions limiting rehearsal and grouping, not an absolute personal limit."},
  {"id": "ew2-neuro-079", "text": "One study estimated that people recognize about 5,000 faces on average.", "category": "signals-senses-and-memory", "source": "faces", "evidence": "published"},
  {"id": "ew2-neuro-080", "text": "After viewing 2,500 objects, participants picked previously seen images over new objects with 92% accuracy.", "category": "signals-senses-and-memory", "source": "objectmemory", "evidence": "published", "note": "Two-choice novel-object condition; finer exemplar and state distinctions yielded 88% and 87%."},
  {"id": "ew2-neuro-081", "text": "A star-nosed mole explores with 22 touch-sensitive nasal tentacles.", "category": "animal-superpowers", "source": "mole", "evidence": "published"},
  {"id": "ew2-neuro-082", "text": "A star-nosed mole's nose is wired with roughly 100,000 nerve fibers.", "category": "animal-superpowers", "source": "mole", "evidence": "published"},
  {"id": "ew2-neuro-083", "text": "Star-nosed moles can identify and eat tiny prey in just 120 milliseconds.", "category": "animal-superpowers", "source": "mole", "evidence": "published"},
  {"id": "ew2-neuro-084", "text": "Some scallops have up to 200 eyes, each using a tiny mirror to focus light.", "category": "animal-superpowers", "source": "scallop", "evidence": "published"},
  {"id": "ew2-neuro-085", "text": "Each scallop eye has 2 retinal layers for different parts of its visual field.", "category": "animal-superpowers", "source": "scallop", "evidence": "published"},
  {"id": "ew2-neuro-086", "text": "Box jellyfish have 24 eyes, despite lacking a centralized brain.", "category": "animal-superpowers", "source": "jellyeyes", "evidence": "published"},
  {"id": "ew2-neuro-087", "text": "Box jellyfish improved obstacle avoidance during just 7.5 minutes of training.", "category": "animal-superpowers", "source": "jellylearn", "evidence": "published", "note": "Tripedalia cystophora laboratory associative-learning experiment."},
  {"id": "ew2-neuro-088", "text": "Some mantis shrimp have 12 color-sensitive photoreceptor types; humans typically have 3.", "category": "animal-superpowers", "source": "mantis", "evidence": "published", "note": "Does not imply superior fine color discrimination."},
  {"id": "ew2-neuro-089", "text": "An electric eel species can produce discharges reaching 860 volts.", "category": "animal-superpowers", "source": "eel", "evidence": "published", "note": "Maximum recorded for Electrophorus voltai in the 2019 study."},
  {"id": "ew2-neuro-090", "text": "An adult common octopus's nervous system is estimated to contain about 500 million neurons.", "category": "animal-superpowers", "source": "octopus", "evidence": "published", "note": "Approximate classic count for Octopus vulgaris; varies with age and body size."},
  {"id": "ew2-neuro-091", "text": "A classic count placed about 60% of a common octopus's neurons in its arms.", "category": "animal-superpowers", "source": "octopus", "evidence": "published", "note": "Young (1963) estimated 300 million arm-ganglion neurons out of about 500 million total; later estimates vary."},
  {"id": "ew2-neuro-092", "text": "Trained honeybees can place zero below 1 on a numerical scale.", "category": "animal-superpowers", "source": "beezero", "evidence": "published", "note": "Behavioral task involving empty sets; not a claim of human-like mathematical understanding."},
  {"id": "ew2-neuro-093", "text": "Honeybees can learn color cues meaning 'add 1' or 'subtract 1.'", "category": "animal-superpowers", "source": "beemath", "evidence": "published", "note": "Tested with small sets of 1 to 5 items."},
  {"id": "ew2-neuro-094", "text": "Cuttlefish in experiments waited up to 130 seconds for a preferred snack.", "category": "animal-superpowers", "source": "cuttlefish", "evidence": "published", "note": "Individual maximum delays ranged 50 to 130 seconds; not every cuttlefish waited 130 seconds."},
  {"id": "ew2-neuro-095", "text": "Sheep in experiments remembered 50 other sheep's faces for over 2 years.", "category": "animal-superpowers", "source": "sheep", "evidence": "published"},
  {"id": "ew2-neuro-096", "text": "Bottlenose dolphins recognized former companions' signature whistles after more than 20 years apart.", "category": "animal-superpowers", "source": "dolphin", "evidence": "published"},
  {"id": "ew2-neuro-097", "text": "Nesting chinstrap penguins can take over 10,000 microsleeps per day.", "category": "animal-superpowers", "source": "penguin", "evidence": "published"},
  {"id": "ew2-neuro-098", "text": "Frigatebirds studied at sea averaged only about 42 minutes of sleep per day.", "category": "animal-superpowers", "source": "frigate", "evidence": "published", "note": "Rounded from 0.69 hours per day in flight; substantially longer sleep on land."},
  {"id": "ew2-neuro-099", "text": "Jumping spiders have 8 eyes, with different pairs handling different visual jobs.", "category": "animal-superpowers", "source": "spider", "evidence": "published"},
  {"id": "ew2-neuro-100", "text": "Nesting chinstrap penguins' sleep bouts averaged just 4 seconds.", "category": "animal-superpowers", "source": "penguin", "evidence": "published"},
];

export const SCIENCE_FACT_SOURCES: Record<string, { title: string; url: string; status?: string; additional_url?: string }> = {
  "fly": {
    "title": "Dorkenwald et al. (2024), Neuronal wiring diagram of an adult brain",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC11446842/"
  },
  "flytypes": {
    "title": "Schlegel et al. (2024), Whole-brain annotation and multi-connectome cell typing of Drosophila",
    "url": "https://www.nature.com/articles/s41586-024-07686-5"
  },
  "flynetwork": {
    "title": "Lin et al. (2024), Network statistics of the whole-brain connectome of Drosophila",
    "url": "https://www.nature.com/articles/s41586-024-07968-y"
  },
  "banc": {
    "title": "Distributed control circuits across a brain-and-cord connectome (2026)",
    "url": "https://www.nature.com/articles/s41586-026-10735-w"
  },
  "microns": {
    "title": "MICrONS Consortium (2025), Functional connectomics spanning multiple areas of mouse visual cortex",
    "url": "https://www.nature.com/articles/s41586-025-08790-w"
  },
  "humanmap": {
    "title": "Shapson-Coe et al. (2024), A petavoxel fragment of human cerebral cortex reconstructed at nanoscale resolution",
    "url": "https://pubmed.ncbi.nlm.nih.gov/38723085/"
  },
  "worm": {
    "title": "Cook et al. (2019), Whole-animal connectomes of both Caenorhabditis elegans sexes",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6889226/"
  },
  "larva": {
    "title": "Winding et al. (2023), The connectome of an insect brain",
    "url": "https://pubmed.ncbi.nlm.nih.gov/36893230/"
  },
  "ciona": {
    "title": "Ryan et al. (2016), The CNS connectome of a tadpole larva of Ciona intestinalis",
    "url": "https://elifesciences.org/articles/16962"
  },
  "museum": {
    "title": "Bae et al. (2018), Digital Museum of Retinal Ganglion Cells with Dense Anatomy and Physiology",
    "url": "https://doi.org/10.1016/j.cell.2018.04.040"
  },
  "eyewirecommunity": {
    "title": "EyeWire (2018), Structural and Functional Diversity of Eyewire Neurons Revealed",
    "url": "https://blog.eyewire.org/structural-and-functional-diversity-of-eyewire-neurons-revealed/"
  },
  "eyewire2": {
    "title": "Ströh et al. (2026), Eyewire II — A connectomic resource for resolving cell types and circuits of the mouse retina [preprint]",
    "url": "https://pubmed.ncbi.nlm.nih.gov/42282520/",
    "status": "preprint"
  },
  "photoreceptors": {
    "title": "Curcio et al. (1990), Human photoreceptor topography",
    "url": "https://pubmed.ncbi.nlm.nih.gov/2324310/"
  },
  "conemosaic": {
    "title": "Roorda and Williams (1999), The arrangement of the three cone classes in the living human eye",
    "url": "https://www.nature.com/articles/17383"
  },
  "mousecells": {
    "title": "Jeon, Strettoi and Masland (1998), The Major Cell Populations of the Mouse Retina",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6793518/"
  },
  "amacrines": {
    "title": "Yan et al. (2020), Mouse Retinal Cell Atlas: Molecular Identification of over Sixty Amacrine Cell Types",
    "url": "https://pubmed.ncbi.nlm.nih.gov/32457074/"
  },
  "rgctypes": {
    "title": "Tran et al. (2019), Single-Cell Profiles of Retinal Ganglion Cells Differing in Resilience to Injury Reveal Neuroprotective Genes",
    "url": "https://pubmed.ncbi.nlm.nih.gov/31784286/"
  },
  "directions": {
    "title": "Kay et al. (2011), Retinal Ganglion Cells with Distinct Directional Preferences Differ in Molecular Identity, Structure, and Central Projections",
    "url": "https://pubmed.ncbi.nlm.nih.gov/21613488/"
  },
  "humanrgc": {
    "title": "Curcio and Allen (1990), Topography of ganglion cells in human retina",
    "url": "https://pubmed.ncbi.nlm.nih.gov/2229487/"
  },
  "photon": {
    "title": "Tinsley et al. (2016), Direct detection of a single photon by humans",
    "url": "https://www.nature.com/articles/ncomms12172"
  },
  "pictures": {
    "title": "Potter et al. (2014), Detecting meaning in RSVP at 13 ms per picture",
    "url": "https://pubmed.ncbi.nlm.nih.gov/24374558/"
  },
  "olo": {
    "title": "Fong et al. (2025), Novel color via stimulation of individual photoreceptors at population scale",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC12007580/"
  },
  "humanneurons": {
    "title": "Azevedo et al. (2009), Equal numbers of neuronal and nonneuronal cells make the human brain an isometrically scaled-up primate brain",
    "url": "https://pubmed.ncbi.nlm.nih.gov/19226510/"
  },
  "humanregions": {
    "title": "Herculano-Houzel (2009), The human brain in numbers: a linearly scaled-up primate brain",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC2776484/"
  },
  "energy": {
    "title": "Raichle (2015), The restless brain: how intrinsic activity organizes brain function",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4387513/"
  },
  "whitematter": {
    "title": "Marner et al. (2003), Marked loss of myelinated nerve fibers in the human brain with age",
    "url": "https://pubmed.ncbi.nlm.nih.gov/12794739/"
  },
  "purkinje": {
    "title": "Napper and Harvey (1988), Number of parallel fiber synapses on an individual Purkinje cell in the cerebellum of the rat",
    "url": "https://pubmed.ncbi.nlm.nih.gov/3209740/"
  },
  "mouseatlas": {
    "title": "Yao et al. (2023), A high-resolution transcriptomic and spatial atlas of cell types in the whole mouse brain",
    "url": "https://www.nature.com/articles/s41586-023-06812-z"
  },
  "humanatlas": {
    "title": "Siletti et al. (2023), Transcriptomic diversity of cell types across the adult human brain",
    "url": "https://pubmed.ncbi.nlm.nih.gov/37824663/"
  },
  "elephant": {
    "title": "Herculano-Houzel et al. (2014), The elephant brain in numbers",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4053853/"
  },
  "birds": {
    "title": "Olkowicz et al. (2016), Birds have primate-like numbers of neurons in the forebrain",
    "url": "https://pubmed.ncbi.nlm.nih.gov/27298365/"
  },
  "astrocytes": {
    "title": "Oberheim et al. (2009), Uniquely Hominid Features of Adult Human Astrocytes",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC2819812/"
  },
  "longevity": {
    "title": "Magrassi et al. (2013), Lifespan of neurons is uncoupled from organismal lifespan",
    "url": "https://pubmed.ncbi.nlm.nih.gov/23440189/"
  },
  "pump": {
    "title": "Kanai et al. (2013), Crystal structure of a Na+-bound Na+,K+-ATPase preceding the E1P state",
    "url": "https://www.nature.com/articles/nature12578"
  },
  "learning": {
    "title": "Xu et al. (2009), Rapid formation and selective stabilization of synapses for enduring motor memories",
    "url": "https://pubmed.ncbi.nlm.nih.gov/19946267/"
  },
  "synapsesleep": {
    "title": "de Vivo et al. (2017), Ultrastructural evidence for synaptic scaling across the wake/sleep cycle",
    "url": "https://pubmed.ncbi.nlm.nih.gov/28154076/"
  },
  "myelin": {
    "title": "Czopka et al. (2013), Individual oligodendrocytes have only a few hours in which to generate new myelin sheaths in vivo",
    "url": "https://pubmed.ncbi.nlm.nih.gov/23806617/"
  },
  "cochlea": {
    "title": "Cochlear Efferent Innervation Is Sparse in Humans and Decreases with Age (2019)",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6880465/"
  },
  "smellgenes": {
    "title": "Verbeurgt et al. (2014), Profiling of Olfactory Receptor Gene Expression in Whole Human Olfactory Mucosa",
    "url": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0096333"
  },
  "smelltiming": {
    "title": "Wu et al. (2024), Human olfactory perception embeds fine temporal resolution within a single sniff",
    "url": "https://www.nature.com/articles/s41562-024-01984-8"
  },
  "smellevolution": {
    "title": "Niimura and Nei (2005), Evolutionary changes of the number of olfactory receptor genes in the human and mouse lineages",
    "url": "https://pubmed.ncbi.nlm.nih.gov/15716099/"
  },
  "memorycapacity": {
    "title": "Cowan (2001), The magical number 4 in short-term memory: a reconsideration of mental storage capacity",
    "url": "https://pubmed.ncbi.nlm.nih.gov/11515286/"
  },
  "faces": {
    "title": "Jenkins et al. (2018), How many faces do people know?",
    "url": "https://pubmed.ncbi.nlm.nih.gov/30305434/"
  },
  "objectmemory": {
    "title": "Brady et al. (2008), Visual long-term memory has a massive storage capacity for object details",
    "url": "https://pubmed.ncbi.nlm.nih.gov/18787113/"
  },
  "mole": {
    "title": "Catania Lab, Star-Nosed Mole research",
    "url": "https://as.vanderbilt.edu/catanialab/research/star-nosed-mole/"
  },
  "scallop": {
    "title": "Palmer et al. (2017), The image-forming mirror in the eye of the scallop",
    "url": "https://pubmed.ncbi.nlm.nih.gov/29191905/"
  },
  "jellyeyes": {
    "title": "Visual pigment in the lens eyes of the box jellyfish Chiropsella bronzie (2010)",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC2871879/"
  },
  "jellylearn": {
    "title": "Bielecki et al. (2023), Associative learning in the box jellyfish Tripedalia cystophora",
    "url": "https://www.sciencedirect.com/science/article/pii/S0960982223011363",
    "additional_url": "https://www.eurekalert.org/news-releases/1001636"
  },
  "mantis": {
    "title": "Thoen et al. (2014), A different form of color vision in mantis shrimp",
    "url": "https://pubmed.ncbi.nlm.nih.gov/24458639/"
  },
  "eel": {
    "title": "de Santana et al. (2019), Unexpected species diversity in electric eels with a description of the strongest living bioelectricity generator",
    "url": "https://www.nature.com/articles/s41467-019-11690-z"
  },
  "octopus": {
    "title": "Young (1963), The number and sizes of nerve cells in Octopus",
    "url": "https://zslpublications.onlinelibrary.wiley.com/doi/10.1111/j.1469-7998.1963.tb01862.x"
  },
  "beezero": {
    "title": "Howard et al. (2018), Numerical ordering of zero in honey bees",
    "url": "https://pubmed.ncbi.nlm.nih.gov/29880690/"
  },
  "beemath": {
    "title": "Howard et al. (2019), Numerical cognition in honeybees enables addition and subtraction",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6365119/"
  },
  "cuttlefish": {
    "title": "Schnell et al. (2021), Cuttlefish exert self-control in a delay of gratification task",
    "url": "https://pubmed.ncbi.nlm.nih.gov/33653135/"
  },
  "sheep": {
    "title": "Kendrick et al. (2001), Sheep don't forget a face",
    "url": "https://pubmed.ncbi.nlm.nih.gov/11700543/"
  },
  "dolphin": {
    "title": "Bruck (2013), Decades-long social memory in bottlenose dolphins",
    "url": "https://pubmed.ncbi.nlm.nih.gov/23926160/"
  },
  "penguin": {
    "title": "Libourel et al. (2023), Nesting chinstrap penguins accrue large quantities of sleep through seconds-long microsleeps",
    "url": "https://pubmed.ncbi.nlm.nih.gov/38033080/"
  },
  "frigate": {
    "title": "Rattenborg et al. (2016), Evidence that birds sleep in mid-flight",
    "url": "https://pubmed.ncbi.nlm.nih.gov/27485308/"
  },
  "spider": {
    "title": "Spano et al. (2012), Secondary eyes mediate the response to looming objects in jumping spiders",
    "url": "https://pubmed.ncbi.nlm.nih.gov/23075526/"
  }
};
