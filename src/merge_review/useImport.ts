// Shared import handlers used by both the top-bar controls and the
// welcome overlay.  Pops the file picker, reads (and gunzips) the file,
// then hands the text to the store.
import { useMergeReviewStore } from "#src/merge_review/store.js";
import { pickFile, readBundleFile } from "#src/merge_review/file.js";

const BUNDLE_ACCEPT =
  ".json,.gz,.json.gz,application/json,application/gzip";

export function useImport() {
  const store = useMergeReviewStore();

  async function importBundle() {
    const f = await pickFile(BUNDLE_ACCEPT);
    if (!f) return;
    try {
      const text = await readBundleFile(f);
      store.importBundleFromText(text);
    } catch (err) {
      alert("Could not read bundle: " + (err as Error).message);
    }
  }

  async function importDecisions() {
    const f = await pickFile(".json");
    if (!f) return;
    store.importDecisionsFromText(await f.text());
  }

  return { importBundle, importDecisions };
}
