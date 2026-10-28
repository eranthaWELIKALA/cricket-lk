-- 016: MVP points presets for clubs.
--
-- MVP points used to be one fixed formula in the app. Now each club keeps its
-- own points presets next to its match and tournament presets: a row in
-- club_presets with kind 'points', its values in `preset` (jsonb, same shape
-- as the app's DEFAULT_POINTS_PRESETS). The one whose preset has
-- "inUse": true counts the club's stats (else the club's first one, else the
-- app's built-in default). Points are worked out in the app from the
-- scorecards whenever stats are shown, so editing a preset recounts every
-- match; nothing here stores points.
--
-- Same members-only RLS as the other club presets (002), so all this needs is
-- the new kind. Run after 002. Safe to run twice.

alter table public.club_presets drop constraint if exists club_presets_kind_check;
alter table public.club_presets add constraint club_presets_kind_check
  check (kind in ('match', 'tournament', 'points'));
