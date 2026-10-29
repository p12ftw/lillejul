-- Uppdatering 2: egen musik per quiz (valfritt – utan fil spelas inbyggd julmusik).
-- Kör i Supabase: SQL Editor -> New query -> klistra in -> Run. Dina quiz påverkas inte.
alter table public.quizzes add column if not exists lobby_music_url text;
alter table public.quizzes add column if not exists question_music_url text;
