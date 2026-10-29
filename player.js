import { sb, $, $$, esc, nl2br, LETTERS, errMsg, sizeClass, syncClock, remainingMs, watchGame, letItSnow } from './lib.js';

const app = $('#app');
const STORE = 'quiz-player';

let me = loadMe();          // { game_id, player_id, secret, name }
let game = null;
let stopWatch = null;
let viewKey = '';
let tick = null;
let kickCheck = null;

function loadMe() { try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; } }
function saveMe(v) { me = v; try { v ? localStorage.setItem(STORE, JSON.stringify(v)) : localStorage.removeItem(STORE); } catch {} }

init();

async function init() {
  letItSnow();
  syncClock();
  const urlPin = new URLSearchParams(location.search).get('pin');
  if (me) {
    const { data } = await sb.from('players').select('id, game_id').eq('id', me.player_id).maybeSingle();
    const { data: g } = data ? await sb.from('games').select('pin').eq('id', data.game_id).maybeSingle() : { data: null };
    // Fortsätt där man var – om man inte skannat en ny PIN
    if (data && g && (!urlPin || urlPin === g.pin)) return enterGame();
    saveMe(null);
  }
  showJoin();
}

function stopAll() {
  stopWatch?.(); stopWatch = null;
  clearInterval(tick); clearInterval(kickCheck);
  viewKey = '';
}

// ---------------- Gå med ----------------
function showJoin(message = '') {
  stopAll();
  const urlPin = new URLSearchParams(location.search).get('pin') || '';
  app.innerHTML = `
    <div class="center">
      <form class="panel" id="join" autocomplete="off">
        <div class="garland"></div>
        <p class="logo">Julquiz 🎄</p>
        <p class="muted">Ange PIN-koden från skärmen och ditt namn</p>
        <input class="field" id="pin" inputmode="numeric" maxlength="6" placeholder="PIN-kod" value="${esc(urlPin)}">
        <input class="field" id="name" maxlength="30" placeholder="Ditt namn" autocapitalize="words">
        <button class="btn" style="width:100%;margin-top:8px">Gå med</button>
        <p class="error" id="err">${esc(message)}</p>
      </form>
    </div>`;
  (urlPin ? $('#name') : $('#pin')).focus();
  $('#join').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#join button');
    btn.disabled = true; $('#err').textContent = '';
    const { data, error } = await sb.rpc('join_game', { p_pin: $('#pin').value.trim(), p_name: $('#name').value });
    btn.disabled = false;
    if (error) { $('#err').textContent = errMsg(error); return; }
    saveMe(data);
    enterGame();
  };
}

// ---------------- Spelet ----------------
function enterGame() {
  stopAll();
  app.innerHTML = `<div class="center"><div class="spinner"></div></div>`;
  stopWatch = watchGame(me.game_id, onGame);
  // Har värden tagit bort mig?
  kickCheck = setInterval(async () => {
    const { data, error } = await sb.from('players').select('id').eq('id', me.player_id).maybeSingle();
    if (error || data || !game) return;
    const { data: g } = await sb.from('games').select('id').eq('id', me.game_id).maybeSingle();
    if (!g) return showEnded();
    saveMe(null);
    showJoin('Du togs bort från quizet. Testa ett annat namn.');
  }, 5000);
}

function onGame(g) {
  if (!g) return showEnded();
  game = g;
  const key = `${g.status}:${g.current_index}`;
  if (key === viewKey) return;
  viewKey = key;
  clearInterval(tick);
  if (g.status === 'lobby') showLobby();
  else if (g.status === 'question') showQuestion();
  else if (g.status === 'reveal') showReveal();
  else if (g.status === 'finished') showFinished();
}

const topbar = (right = '') => `
  <div class="topbar"><span>${esc(me.name)}</span>${right}</div>`;

function showLobby() {
  app.innerHTML = `
    <div class="play">
      ${topbar()}
      <div class="result">
        <div style="font-size:4rem">🎄</div>
        <p class="big">Du är med!</p>
        <p class="muted" style="font-size:1.2rem">Leta upp ditt namn på skärmen.<br>Julquizet startar snart …</p>
        <div class="spinner" style="margin-top:20px"></div>
      </div>
    </div>`;
}

function showQuestion() {
  const q = game.current_question;
  const opts = q.options
    .map((t, i) => ({ t, i }))
    .filter(o => o.t && o.t.trim());
  app.innerHTML = `
    <div class="play">
      ${topbar(`<span>Fråga ${q.index + 1}/${game.total_questions}</span><span class="timer-pill" id="time"></span>`)}
      <div class="qtext ${sizeClass(q.text)}">${nl2br(q.text)}</div>
      ${q.image_url ? `<img class="qimg" src="${esc(q.image_url)}" alt="">` : ''}
      <div class="opts" id="opts">
        ${opts.map(o => `
          <button class="opt o${o.i}" data-i="${o.i}">
            <span class="letter">${LETTERS[o.i]}</span><span>${nl2br(o.t)}</span>
          </button>`).join('')}
      </div>
      <p class="muted" id="status" style="text-align:center;min-height:1.4em;margin:0"></p>
    </div>`;

  let locked = false;
  const lock = (msg) => {
    locked = true;
    $$('#opts .opt').forEach(b => b.disabled = true);
    if (msg) $('#status').textContent = msg;
  };

  $$('#opts .opt').forEach(btn => btn.onclick = async () => {
    if (locked) return;
    const choice = Number(btn.dataset.i);
    lock();
    $$('#opts .opt').forEach(b => b.classList.toggle('dim', b !== btn));
    btn.classList.add('chosen');
    $('#status').textContent = 'Skickar …';
    const { data, error } = await sb.rpc('submit_answer', { p_player_id: me.player_id, p_secret: me.secret, p_choice: choice });
    if (viewKey !== `question:${q.index}`) return;
    if (error) { $('#status').textContent = errMsg(error); return; }
    if (data.accepted) $('#status').textContent = 'Svar skickat! Väntar på de andra …';
    else if (data.reason === 'already') $('#status').textContent = 'Du har redan svarat på den här frågan.';
    else $('#status').textContent = 'För sent – tiden tog slut.';
  });

  // Har jag redan svarat (t.ex. efter omladdning)?
  sb.rpc('my_result', { p_player_id: me.player_id, p_secret: me.secret }).then(({ data }) => {
    if (data?.answered && viewKey === `question:${q.index}`) {
      lock('Du har redan svarat. Väntar på de andra …');
      $$('#opts .opt').forEach(b => b.classList.add('dim'));
    }
  });

  const update = () => {
    const s = Math.ceil(remainingMs(game) / 1000);
    const el = $('#time');
    if (!el) return;
    el.textContent = s;
    el.classList.toggle('low', s <= 5);
    if (s <= 0 && !locked) lock('Tiden är ute!');
  };
  update();
  tick = setInterval(update, 250);
}

async function showReveal() {
  const key = viewKey;
  app.innerHTML = `<div class="play">${topbar()}<div class="result"><div class="spinner"></div></div></div>`;
  const { data: r, error } = await sb.rpc('my_result', { p_player_id: me.player_id, p_secret: me.secret });
  if (viewKey !== key) return;
  if (error) { $('.result').innerHTML = `<p class="error">${esc(errMsg(error))}</p>`; return; }

  const correctIdx = game.reveal?.correct_index;
  const correctText = game.current_question?.options?.[correctIdx] ?? '';
  const [cls, icon, title] = !r.answered ? ['none', '–', 'Inget svar']
    : r.correct ? ['ok', '✓', 'Rätt! 🎉'] : ['bad', '✕', 'Fel'];

  app.innerHTML = `
    <div class="play">
      ${topbar(`<span>${r.score} p</span>`)}
      <div class="result">
        <div class="badge ${cls}">${icon}</div>
        <p class="big">${title}</p>
        ${r.correct ? `<p style="font-size:1.6rem;font-weight:800;margin:0">+${r.points} poäng</p>` : ''}
        ${!r.correct && correctText ? `<p class="muted">Rätt svar: <strong style="color:#fff">${LETTERS[correctIdx]} – ${nl2br(correctText)}</strong></p>` : ''}
        <p style="font-size:1.2rem;margin-top:16px">Du ligger på plats <strong>${r.rank}</strong> av ${r.players}</p>
      </div>
    </div>`;
}

async function showFinished() {
  const key = viewKey;
  const [{ data: r }, { data: top }] = await Promise.all([
    sb.rpc('my_result', { p_player_id: me.player_id, p_secret: me.secret }),
    sb.from('players').select('name, score').eq('game_id', me.game_id).order('score', { ascending: false }).limit(3),
  ]);
  if (viewKey !== key) return;
  const medal = ['🎅', '🥈', '🥉'][r?.rank - 1] || '🎁';
  app.innerHTML = `
    <div class="play">
      ${topbar(`<span>${r?.score ?? 0} p</span>`)}
      <div class="result">
        <div style="font-size:5rem">${medal}</div>
        <p class="big">Plats ${r?.rank ?? '–'}</p>
        <p class="muted" style="font-size:1.2rem">av ${r?.players ?? '–'} med ${r?.score ?? 0} poäng</p>
        <div class="board" style="margin-top:20px;text-align:left">
          ${(top || []).map((p, i) => `
            <div class="row ${i === 0 ? 'first' : ''}" style="font-size:1.1rem">
              <span class="pos">${i + 1}</span><span>${esc(p.name)}</span><span class="score">${p.score}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function showEnded() {
  stopAll();
  saveMe(null);
  app.innerHTML = `
    <div class="center">
      <div class="panel">
        <div class="garland"></div>
        <h1>God jul! 🎅</h1>
        <p class="muted">Julquizet är avslutat – tack för att du var med!</p>
        <button class="btn" id="again" style="margin-top:12px">Gå med i ett nytt quiz</button>
      </div>
    </div>`;
  $('#again').onclick = () => { history.replaceState(null, '', location.pathname); showJoin(); };
}
