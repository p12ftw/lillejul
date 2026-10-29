-- Uppdatering 1: frågan visas först, svarsalternativen när värden trycker.
-- Kör i Supabase: SQL Editor -> New query -> klistra in -> Run. Dina quiz påverkas inte.

delete from public.games;  -- avslutar ev. pågående omgång (quizen ligger kvar)

alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check
  check (status in ('lobby','intro','question','reveal','finished'));

-- VÄRD: gå till nästa fråga (eller avsluta när frågorna är slut).
-- Frågan visas först utan svarsalternativ (status 'intro').
create or replace function public.next_question(p_game_id uuid) returns public.games
language plpgsql security definer set search_path = public as $$
declare g games; q questions;
begin
  select * into g from games where id = p_game_id and host = auth.uid() for update;
  if not found then raise exception 'Inte behörig'; end if;
  if g.status = 'finished' then return g; end if;

  select * into q from questions where quiz_id = g.quiz_id
    order by position, id offset g.current_index + 1 limit 1;

  if not found then
    update games set status = 'finished', current_question = null, reveal = null
      where id = g.id returning * into g;
    return g;
  end if;

  update games set
    status              = 'intro',
    current_index       = g.current_index + 1,
    current_question_id = q.id,
    question_started_at = null,
    reveal              = null,
    current_question    = jsonb_build_object(
      'index',      g.current_index + 1,
      'text',       q.text,
      'image_url',  q.image_url,
      'time_limit', q.time_limit)
  where id = g.id returning * into g;
  return g;
end $$;

-- VÄRD: visa svarsalternativen och starta klockan
create or replace function public.show_options(p_game_id uuid) returns public.games
language plpgsql security definer set search_path = public as $$
declare g games; q questions;
begin
  select * into g from games where id = p_game_id and host = auth.uid() for update;
  if not found then raise exception 'Inte behörig'; end if;
  if g.status <> 'intro' then return g; end if;
  select * into q from questions where id = g.current_question_id;
  update games set
    status              = 'question',
    question_started_at = clock_timestamp(),
    current_question    = g.current_question || jsonb_build_object(
      'options',    to_jsonb(coalesce(q.options, array['','','',''])),
      'time_limit', coalesce(q.time_limit, (g.current_question->>'time_limit')::int))
  where id = g.id returning * into g;
  return g;
end $$;

revoke all on function public.show_options(uuid) from public, anon, authenticated;
grant execute on function public.show_options(uuid) to authenticated;
