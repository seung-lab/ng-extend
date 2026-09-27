/**
 * Where EyeWire II's server functions run (source: functions/ in this repo).
 * Every call to them builds its URL here, so moving projects is one line.
 */
export const FUNCTIONS_BASE = 'https://us-central1-eyewire-ii-e4d52.cloudfunctions.net';

export const functionUrl = (name: string) => `${FUNCTIONS_BASE}/${name}`;
