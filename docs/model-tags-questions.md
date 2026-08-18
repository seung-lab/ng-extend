# Questions for Sven and Fuming about the merge-error export format

Context: we now ingest the per-neuron window exports (schema_version 1,
hybrid partition) into EyeWire II's scout tag system. Suspect windows become
AI candidate tags with the verify probability as confidence, all windows feed
a per-neuron heat layer, and the 25 labeled token points render as a proposed
split overlay. Draft questions before we scale past the two demo neurons:

1. Is verify_prob calibrated? The files use verify_thresh 0.2, but nearly all
   suspects sit above 0.9 (file 1: 40 of 50 above 0.9, file 2: 186 of 220).
   Should we treat 0.2 as "worth a look" and 0.9 as "almost certainly a
   merger", or is the scale only ordinal? This drives our color ramp and any
   future auto-prioritization.

2. RESOLVED on our side, please confirm: your latest_root_id values
   resolve on the rolling public table (segmentation/table/minnie65_public)
   but not on the frozen minnie65_public_v117 snapshot our main MICrONS
   entry uses, so we added a MICrONS Live entry on the rolling table for
   candidate review. Is the rolling table the intended target for your
   exports going forward? Related: if a Scythe fixes one merger the root
   id changes; do the remaining windows stay spatially valid, and is there
   a recommended re-anchoring path (we can resolve supervoxels to current
   roots through PCG on our side)?

3. Can you export per-dataset batches on a schedule (daily or weekly) so we
   can cron the ingestion? A stable naming scheme (datastack, root id, export
   date in the filename) plus a manifest file would let our importer pick up
   new files automatically and replace stale candidates for re-run neurons.

4. Do you plan to emit a category or error-type label per suspect window
   (our human taxonomy is snip, hairball, twins, debris)? The UI already has
   an icon slot per candidate that will pick up a category field as soon as
   the export carries one.

5. The token labels give the proposed 2-way partition. Is the sign convention
   stable (label 0 = the side containing the anchor soma, or arbitrary per
   window)? And is spectral.score comparable across windows and neurons, or
   only within one window?

6. minnie65_public is the demo datastack. For EyeWire II production we would
   want stroeh_mouse_retina: any blockers to running the detector there?
