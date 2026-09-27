/** Spreadsheet signing moved out of the browser after credential containment. */
export async function getAccessToken(): Promise<string> {
  throw new Error('Spreadsheet syncing is temporarily unavailable. Your EyeWire II changes are still saved in the app.');
}
