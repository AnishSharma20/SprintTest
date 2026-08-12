-- 0012: a team-uploaded slide can be an AI-FILLED DESIGN, not only a verbatim slide.
--
-- Until now "Add your own slides" meant one thing: the slide goes into decks exactly as drawn
-- and the AI writes nothing on it. That is right for a finished slide (a company overview, an
-- ingredient panel), but it was the ONLY option — so someone who downloaded a standard slide,
-- restyled it and uploaded it back through that flow got a frozen copy instead of a design the
-- AI keeps filling, which is what they meant (and what the layout_overrides table already does
-- for the built-in layouts, see 0009).
--
-- slots is the same text-slot map layout_overrides stores: what text boxes the design has, what
-- they currently say, and how much text fits in each (measured by the deck service's
-- /slides/inspect-slots). Empty/null slots = verbatim, exactly as before, so every existing row
-- keeps its current behaviour with no backfill.

alter table custom_slides add column slots jsonb;
