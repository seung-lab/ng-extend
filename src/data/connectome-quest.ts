/**
 * connectome.quest resource catalog.
 *
 * connectome.quest is the public Seung Lab citizen science site (datasets,
 * Neuro 101, videos, help, the Connectome Atlas). This is the single source
 * for those links so the command palette, the Cell Library Help tab, and the
 * Nurro guide dock all offer the same set.
 */

export interface QuestResource {
  id: string;
  label: string;
  description: string;
  url: string;
  icon: string;
  /** Extra search terms for the command palette. */
  aliases: string[];
}

export const CONNECTOME_QUEST_URL = 'https://connectome.quest';

export const CONNECTOME_QUEST_RESOURCES: QuestResource[] = [
  {
    id: 'quest-home',
    label: 'connectome.quest',
    description: 'Map the brain: datasets, citizen science, and how to get involved',
    url: CONNECTOME_QUEST_URL,
    icon: '🧠',
    aliases: ['connectome quest', 'datasets', 'citizen science', 'map the brain'],
  },
  {
    id: 'quest-neuro101',
    label: 'Neuro 101',
    description: 'A guided zoom from the whole brain down to synapses',
    url: `${CONNECTOME_QUEST_URL}/learn.html`,
    icon: '🔭',
    aliases: ['neuro 101', 'learn', 'brain basics', 'inner cosmos', 'explore'],
  },
  {
    id: 'quest-videos',
    label: 'Neuron Videos',
    description: 'Real neuron animations and lab channels',
    url: `${CONNECTOME_QUEST_URL}/videos.html`,
    icon: '🎬',
    aliases: ['videos', 'animations', 'neuron movies', 'youtube'],
  },
  {
    id: 'quest-help',
    label: 'Help Center',
    description: 'Getting started, software tutorials, and contact',
    url: `${CONNECTOME_QUEST_URL}/help.html`,
    icon: '🛟',
    aliases: ['help center', 'support', 'contact', 'getting started'],
  },
  {
    id: 'quest-access',
    label: 'Get Full Access',
    description: 'The four steps from sandbox practice to a real invitation',
    url: `${CONNECTOME_QUEST_URL}/access.html`,
    icon: '🔑',
    aliases: ['access', 'invitation', 'sandbox', 'get started', 'production access'],
  },
  {
    id: 'quest-atlas',
    label: 'Connectome 101 Atlas',
    description: 'An interactive atlas of connectomes across species',
    url: `${CONNECTOME_QUEST_URL}/atlas/`,
    icon: '🗺️',
    aliases: ['atlas', 'connectome 101', 'species', 'brains'],
  },
];
