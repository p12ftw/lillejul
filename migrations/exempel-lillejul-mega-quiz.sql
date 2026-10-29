-- Exempelquiz: Lillejul Mega Quiz (10 julfrågor)
-- Kör i Supabase: SQL Editor -> New query -> klistra in -> Run.
-- Lägger till ett nytt quiz på ditt admin-konto. Kan köras flera gånger (blir ett nytt quiz varje gång).

with admin as (
  select id from auth.users order by created_at limit 1
), quiz as (
  insert into public.quizzes (owner, title)
  select id, 'Lillejul Mega Quiz – exempel' from admin
  returning id
)
insert into public.questions (quiz_id, position, text, options, correct_index, time_limit)
select quiz.id, q.pos, q.text, q.opts, q.correct, q.secs
from quiz, (values
  (0, 'Vilket datum firas Lucia i Sverige?',
      array['6 december', '13 december', '21 december', '24 december'], 1, 15),

  (1, 'Vad heter tomtens ren med den lysande röda mulen?',
      array['Blixten', 'Komet', 'Rudolf', 'Dansare'], 2, 15),

  (2, 'Vilken krydda ger lussekatterna deras gula färg?',
      array['Gurkmeja', 'Kardemumma', 'Ingefära', 'Saffran'], 3, 15),

  (3, 'Vilken tid på julafton sänds ”Kalle Anka och hans vänner önskar god jul” traditionellt i SVT?',
      array['13.00', '15.00', '17.00', '19.00'], 1, 20),

  (4, 'Varje år skänker ett land den stora julgranen som står på Trafalgar Square i London, som tack för hjälpen under andra världskriget. Vilket land?',
      array['Sverige', 'Danmark', 'Norge', 'Finland'], 2, 25),

  (5, 'I vilket land tros traditionen att ha en julgran inomhus ha sitt ursprung?',
      array['Tyskland', 'Sverige', 'England', 'Ryssland'], 0, 20),

  (6, 'Vilken läsk brukar sälja mer än Coca-Cola i Sverige under december?',
      array['Trocadero', 'Julmust', 'Pommac', 'Sockerdricka'], 1, 15),

  (7, 'Vilket år hade den klassiska julfilmen ”Tre nötter till Askungen” premiär?',
      array['1959', '1966', '1973', '1984'], 2, 20),

  (8, 'Tjugondag Knut avslutar julen – då ”dansas granen ut”. Vilket datum infaller tjugondag Knut?',
      array['6 januari', '13 januari', '20 januari', '31 december'], 1, 20),

  (9, 'Hon föddes i Kalmar 1854 och anses vara den som gav den svenska jultomten hans utseende – en liten, snäll gubbe i röd luva – genom tusentals julkort, tidningsomslag och bokillustrationer. Vem var konstnären?',
      array['Elsa Beskow', 'Jenny Nyström', 'Carl Larsson', 'Astrid Lindgren'], 1, 30)
) as q(pos, text, opts, correct, secs);
