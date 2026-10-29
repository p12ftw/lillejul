-- =====================================================================
--  Quiz-app – Supabase-schema
--  Kör hela filen i Supabase: SQL Editor -> New query -> klistra in -> Run
--  OBS: Filen är till för FÖRSTA installationen. Kör du om den raderas
--  alla quiz och frågor. Uppdateringar finns i mappen migrations/.
-- =====================================================================

-- ---------- Städa (gör filen omkörbar) ----------
drop function if exists public.server_time();
drop function if exists public.create_game(uuid);
drop function if exists public.next_question(uuid);
drop function if exists public.show_options(uuid);
drop function if exists public.reveal_answer(uuid);
drop function if exists public.end_game(uuid);
drop function if exists public.kick_player(uuid);
drop function if exists public.join_game(text, text);
drop function if exists public.submit_answer(uuid, uuid, int);
drop function if exists public.my_result(uuid, uuid);
drop table if exists public.answers cascade;
drop table if exists public.player_secrets cascade;
drop table if exists public.players cascade;
drop table if exists public.games cascade;
drop table if exists public.questions cascade;
drop table if exists public.quizzes cascade;

-- ---------- Tabeller ----------

-- Quiz som du skapar i admin (sparas)
create table public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'Nytt quiz',
  lobby_music_url     text,   -- egen väntmusik (annars inbyggd)
  question_music_url  text,   -- egen frågemusik (annars inbyggd)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Frågor (ingen teckenbegränsning)
create table public.questions (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes(id) on delete cascade,
  position       int  not null default 0,
  text           text not null default '',
  image_url      text,
  options        text[] not null default array['','','',''],
  correct_index  int  not null default 0 check (correct_index between 0 and 3),
  time_limit     int  not null default 20 check (time_limit between 5 and 600),
  check (array_length(options, 1) = 4)
);
create index on public.questions (quiz_id, position);

-- En pågående spelomgång (raderas när du avslutar)
create table public.games (
  id                   uuid primary key default gen_random_uuid(),
  pin                  text not null unique,
  quiz_id              uuid not null references public.quizzes(id) on delete cascade,
  host                 uuid not null default auth.uid(),
  status               text not null default 'lobby'
                       check (status in ('lobby','intro','question','reveal','finished')),
  current_index        int  not null default -1,
  total_questions      int  not null default 0,
  current_question_id  uuid,
  question_started_at  timestamptz,
  current_question     jsonb,   -- fråga + alternativ, UTAN rätt svar
  reveal               jsonb,   -- rätt svar + fördelning, fylls först vid "visa svar"
  created_at           timestamptz not null default now()
);

create table public.players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  name       text not null,
  score      int  not null default 0,
  joined_at  timestamptz not null default now()
);
create unique index players_unique_name on public.players (game_id, lower(name));

-- Hemlig nyckel per deltagare så ingen kan svara åt någon annan
create table public.player_secrets (
  player_id  uuid primary key references public.players(id) on delete cascade,
  secret     uuid not null default gen_random_uuid()
);

create table public.answers (
  game_id         uuid not null references public.games(id) on delete cascade,
  player_id       uuid not null references public.players(id) on delete cascade,
  question_index  int  not null,
  choice          int  not null,
  correct         boolean not null,
  points          int  not null,
  ms              int  not null,
  created_at      timestamptz not null default now(),
  primary key (player_id, question_index)
);
create index on public.answers (game_id, question_index);

-- ---------- Behörigheter (RLS) ----------
alter table public.quizzes        enable row level security;
alter table public.questions      enable row level security;
alter table public.games          enable row level security;
alter table public.players        enable row level security;
alter table public.player_secrets enable row level security;
alter table public.answers        enable row level security;

-- Admin (inloggad) äger sina quiz och frågor
create policy quizzes_owner on public.quizzes for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

create policy questions_owner on public.questions for all to authenticated
  using (exists (select 1 from public.quizzes z where z.id = quiz_id and z.owner = auth.uid()))
  with check (exists (select 1 from public.quizzes z where z.id = quiz_id and z.owner = auth.uid()));

-- Spelets läge och deltagarlistan får alla läsa (innehåller inga facit)
create policy games_read   on public.games   for select to anon, authenticated using (true);
create policy players_read on public.players for select to anon, authenticated using (true);

-- Svar kan bara värden läsa
create policy answers_host on public.answers for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.host = auth.uid()));

-- player_secrets: inga policies = ingen direktåtkomst alls

grant usage on schema public to anon, authenticated;
revoke all on public.quizzes, public.questions, public.games, public.players,
              public.player_secrets, public.answers from anon, authenticated;
grant select, insert, update, delete on public.quizzes, public.questions to authenticated;
grant select on public.games, public.players to anon, authenticated;
grant select on public.answers to authenticated;

-- ---------- Funktioner ----------

create function public.server_time() returns timestamptz
language sql stable as $$ select clock_timestamp() $$;

-- VÄRD: starta en ny spelomgång (tar bort dina gamla omgångar)
create function public.create_game(p_quiz_id uuid) returns public.games
language plpgsql security definer set search_path = public as $$
declare g games; v_pin text; v_total int;
begin
  if auth.uid() is null or not exists (select 1 from quizzes where id = p_quiz_id and owner = auth.uid()) then
    raise exception 'Inte behörig';
  end if;
  select count(*) into v_total from questions where quiz_id = p_quiz_id;
  if v_total = 0 then raise exception 'Quizet har inga frågor ännu'; end if;

  delete from games where host = auth.uid();

  loop
    v_pin := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from games where pin = v_pin);
  end loop;

  insert into games (pin, quiz_id, host, total_questions)
  values (v_pin, p_quiz_id, auth.uid(), v_total)
  returning * into g;
  return g;
end $$;

-- VÄRD: gå till nästa fråga (eller avsluta när frågorna är slut).
-- Frågan visas först utan svarsalternativ (status 'intro').
create function public.next_question(p_game_id uuid) returns public.games
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
create function public.show_options(p_game_id uuid) returns public.games
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

-- VÄRD: stäng frågan, visa rätt svar och dela ut poängen
create function public.reveal_answer(p_game_id uuid) returns public.games
language plpgsql security definer set search_path = public as $$
declare g games; v_correct int; v_counts int[];
begin
  select * into g from games where id = p_game_id and host = auth.uid() for update;
  if not found then raise exception 'Inte behörig'; end if;
  if g.status <> 'question' then return g; end if;

  select correct_index into v_correct from questions where id = g.current_question_id;

  select array[
      count(*) filter (where choice = 0),
      count(*) filter (where choice = 1),
      count(*) filter (where choice = 2),
      count(*) filter (where choice = 3)]::int[]
    into v_counts
    from answers where game_id = g.id and question_index = g.current_index;

  update players p set score = p.score + a.points
    from answers a
   where a.player_id = p.id and a.game_id = g.id and a.question_index = g.current_index;

  update games set
    status = 'reveal',
    reveal = jsonb_build_object(
      'correct_index', coalesce(v_correct, -1),
      'counts',        to_jsonb(v_counts),
      'answered',      v_counts[1] + v_counts[2] + v_counts[3] + v_counts[4])
  where id = g.id returning * into g;
  return g;
end $$;

-- VÄRD: avsluta och radera omgången (deltagare och svar försvinner)
create function public.end_game(p_game_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from games where id = p_game_id and host = auth.uid();
end $$;

-- VÄRD: ta bort en deltagare (t.ex. olämpligt namn)
create function public.kick_player(p_player_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from players p using games g
   where p.id = p_player_id and g.id = p.game_id and g.host = auth.uid();
end $$;

-- DELTAGARE: gå med med PIN och namn
create function public.join_game(p_pin text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g games; v_name text; v_player uuid; v_secret uuid;
begin
  v_name := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if length(v_name) < 1 then raise exception 'Skriv ett namn'; end if;
  if length(v_name) > 30 then raise exception 'Namnet får vara max 30 tecken'; end if;

  select * into g from games where pin = trim(p_pin);
  if not found then raise exception 'Hittar inget quiz med den PIN-koden'; end if;
  if g.status = 'finished' then raise exception 'Quizet är redan slut'; end if;

  if exists (select 1 from players where game_id = g.id and lower(name) = lower(v_name)) then
    raise exception 'Namnet är redan taget – välj ett annat';
  end if;

  insert into players (game_id, name) values (g.id, v_name) returning id into v_player;
  insert into player_secrets (player_id) values (v_player) returning secret into v_secret;

  return jsonb_build_object('player_id', v_player, 'secret', v_secret,
                            'game_id', g.id, 'name', v_name);
end $$;

-- DELTAGARE: skicka svar. Tiden mäts på servern.
-- Poäng: rätt svar ger 500–1000 beroende på hur snabbt (som Kahoot), fel ger 0.
create function public.submit_answer(p_player_id uuid, p_secret uuid, p_choice int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g games; q questions; v_ms int; v_limit int; v_correct boolean; v_points int; v_rows int;
begin
  if not exists (select 1 from player_secrets where player_id = p_player_id and secret = p_secret) then
    raise exception 'Okänd deltagare';
  end if;

  select * into g from games
   where id = (select game_id from players where id = p_player_id)
   for share;
  if not found or g.status <> 'question' then
    return jsonb_build_object('accepted', false, 'reason', 'closed');
  end if;

  select * into q from questions where id = g.current_question_id;
  if not found then return jsonb_build_object('accepted', false, 'reason', 'closed'); end if;

  if p_choice is null or p_choice < 0 or p_choice > 3
     or coalesce(trim(q.options[p_choice + 1]), '') = '' then
    raise exception 'Ogiltigt svar';
  end if;

  v_limit := q.time_limit * 1000;
  v_ms := floor(extract(epoch from (clock_timestamp() - g.question_started_at)) * 1000)::int;
  if v_ms > v_limit + 1500 then   -- 1,5 s marginal för nätverket
    return jsonb_build_object('accepted', false, 'reason', 'late');
  end if;

  v_correct := (p_choice = q.correct_index);
  v_points  := case when v_correct
                 then round(1000 * (1 - least(greatest(v_ms, 0), v_limit)::numeric / v_limit / 2))::int
                 else 0 end;

  insert into answers (game_id, player_id, question_index, choice, correct, points, ms)
  values (g.id, p_player_id, g.current_index, p_choice, v_correct, v_points, greatest(v_ms, 0))
  on conflict (player_id, question_index) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('accepted', false, 'reason', 'already'); end if;

  return jsonb_build_object('accepted', true);
end $$;

-- DELTAGARE: mitt resultat för senaste frågan + placering
create function public.my_result(p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; g games; a answers; v_rank int; v_total int;
begin
  if not exists (select 1 from player_secrets where player_id = p_player_id and secret = p_secret) then
    raise exception 'Okänd deltagare';
  end if;
  select * into p from players where id = p_player_id;
  select * into g from games where id = p.game_id;
  select * into a from answers where player_id = p.id and question_index = g.current_index;
  select count(*) + 1 into v_rank  from players where game_id = g.id and score > p.score;
  select count(*)     into v_total from players where game_id = g.id;

  if g.status = 'question' then
    return jsonb_build_object('answered', a.player_id is not null);
  end if;

  return jsonb_build_object(
    'answered', a.player_id is not null,
    'choice',   a.choice,
    'correct',  coalesce(a.correct, false),
    'points',   coalesce(a.points, 0),
    'score',    p.score,
    'rank',     v_rank,
    'players',  v_total);
end $$;

revoke all on function public.create_game(uuid), public.next_question(uuid), public.show_options(uuid), public.reveal_answer(uuid),
                       public.end_game(uuid), public.kick_player(uuid), public.join_game(text, text),
                       public.submit_answer(uuid, uuid, int), public.my_result(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.server_time() to anon, authenticated;
grant execute on function public.create_game(uuid), public.next_question(uuid), public.show_options(uuid),
                          public.reveal_answer(uuid), public.end_game(uuid), public.kick_player(uuid)
  to authenticated;
grant execute on function public.join_game(text, text), public.submit_answer(uuid, uuid, int),
                          public.my_result(uuid, uuid)
  to anon, authenticated;

-- ---------- Realtid ----------
-- Deltagarnas telefoner lyssnar på ändringar i spelets läge.
do $$ begin
  alter publication supabase_realtime add table public.games;
exception when duplicate_object then null; end $$;

-- ---------- Bildlagring ----------
insert into storage.buckets (id, name, public)
values ('quiz-images', 'quiz-images', true)
on conflict (id) do update set public = true;

drop policy if exists "quiz images upload" on storage.objects;
drop policy if exists "quiz images delete" on storage.objects;
create policy "quiz images upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'quiz-images');
create policy "quiz images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'quiz-images' and owner = auth.uid());
