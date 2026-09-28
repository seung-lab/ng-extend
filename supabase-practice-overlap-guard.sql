-- Two tutorials can share immutable pieces. Serialize their claims and reset
-- leases at the database boundary, including RPCs and older browser clients.
CREATE OR REPLACE FUNCTION public.guard_practice_overlap()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status NOT IN ('in_use','resetting') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(98127, 61749);
  IF EXISTS (
    SELECT 1 FROM public.tutorial_practice_examples other
    WHERE other.id <> NEW.id AND other.enabled
      AND other.pcg_server = NEW.pcg_server AND other.pcg_table = NEW.pcg_table
      AND (other.status = 'resetting' OR
           (other.status = 'in_use' AND (other.expires_at IS NULL OR other.expires_at > now())))
      AND ARRAY[NULLIF(other.supervoxel_a,''), NULLIF(other.supervoxel_b,'')]
          && ARRAY[NULLIF(NEW.supervoxel_a,''), NULLIF(NEW.supervoxel_b,'')]
  ) THEN
    RAISE EXCEPTION 'A shared practice cell is already in use. Please retry shortly.' USING ERRCODE = '55P03';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER tutorial_practice_overlap_guard
BEFORE INSERT OR UPDATE ON public.tutorial_practice_examples
FOR EACH ROW EXECUTE FUNCTION public.guard_practice_overlap();
