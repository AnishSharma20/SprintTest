-- 0008: custom slide files move to Supabase Storage instead of base64-in-Postgres.
--
-- Uploading/saving a team slide used to carry the whole .pptx as base64 through a Vercel
-- serverless function twice (once to inspect/preview it, once to save it) — both hops capped
-- at Vercel's ~4.5 MB request-body ceiling, in practice a 4 MB file limit. A single slide with
-- a decent image or embedded video easily blows past that.
--
-- storage_path replaces pptx_b64 for NEW uploads: the browser now gets a short-lived signed
-- Storage upload URL from the app and PUTs the file straight to Storage, never through Vercel.
-- pptx_b64 stays for existing rows (nullable now, so either can be set) — no backfill needed,
-- old rows keep working exactly as before, only new saves take the storage path.
--
-- The bucket is private: only the service role (used server-side, see app/lib/supabase.ts)
-- reads it directly; the browser only ever gets a narrow, time-limited signed URL, either to
-- upload once (Storage) or never to read (all reads go through our API routes).

alter table custom_slide_files
  alter column pptx_b64 drop not null,
  add column storage_path text,
  add constraint custom_slide_files_has_content
    check (pptx_b64 is not null or storage_path is not null);

insert into storage.buckets (id, name, public)
values ('custom-slides', 'custom-slides', false)
on conflict (id) do nothing;
