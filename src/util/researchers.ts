/**
 * Researchers from the labs (Ames 2026-11-21: "Make Jan's account gold - he is
 * with a research lab"): their names are gold in chat, like admins, but they
 * have no admin powers. The server gives their messages rank 'researcher'
 * (functions/community-data.js RESEARCHERS); keep the two lists in step.
 */
export const RESEARCHERS = new Set<string>([
  '5bb0310a-b42d-4d13-937f-eab620794949',  // Jan Lause (jan_lause)
]);
export const isResearcher = (id: string | null | undefined) => !!id && RESEARCHERS.has(String(id).toLowerCase());
