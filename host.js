import { sb, $, $$, esc, nl2br, LETTERS, errMsg, sizeClass, syncClock, remainingMs, letItSnow } from './lib.js';

const app = $('#app');
const gameId = new URLSearchParams(location.search).get('game');

let game = null;
let players = [];
let loops = [];
let busy = false;
let revealSent = false;

const stopLoops = () => { loops.forEach(clearInterval); loops = []; };
const every = (fn, ms) => { fn(); loops.push(setInterval(fn, ms)); };

init();

// Mellanslag / Enter / pil höger = klicka på sidans huvudknapp (funkar med presenter-klicker)
document.addEventListener('keydown', e => {
  if (!['Space', 'Enter', 'ArrowRight', 'PageDown'].includes(e.code)) return;
  if (e.target.closest?.('input, textarea, select')) return;
  const btn = $('[data-primary]');
  if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
});

async function init() {
  letItSnow(48);
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.href = 'admin.html'; return; }
  if (!gameId) { location.href = 'admin.html'; return; }
  await syncClock();
  const { data, error } = await sb.from('games').select('*').eq('id', gameId).maybeSingle();
  if (error || !data) return showGone();
  setGame(data);
}

async function loadPlayers() {
  const { data } = await sb.from('players').select('id, name, score').eq('game_id', gameId).order('joined_at');
  if (data) players = data;
  return players;
}

/** Kör en värdåtgärd (RPC som returnerar nytt spelläge). */
async function act(fn, args = {}) {
  if (busy) return false;
  busy = true;
  const { data, error } = await sb.rpc(fn, { p_game_id: gameId, ...args });
  busy = false;
  if (error) { alert(errMsg(error)); return false; }
  if (data) setGame(data);
  return true;
}

function setGame(g) {
  game = g;
  stopLoops();
  revealSent = false;
  if (g.status === 'lobby') showLobby();
  else if (g.status === 'intro') showIntro();
  else if (g.status === 'question') showQuestion();
  else if (g.status === 'reveal') showReveal();
  else if (g.status === 'finished') showFinished();
}

const header = (extra = '') => `
  <div class="head">
    <div style="font-size:1.3rem;font-weight:600">${extra}</div>
    <div class="actions">
      <span class="muted" style="align-self:center">PIN <strong style="color:#fff">${esc(game.pin)}</strong></span>
      <button class="btn ghost small" id="endBtn">Avsluta</button>
    </div>
  </div>`;

function wireEnd() {
  $('#endBtn')?.addEventListener('click', endGame);
}
async function endGame() {
  if (!confirm('Avsluta quizet? Alla deltagare och resultat raderas.')) return;
  await sb.rpc('end_game', { p_game_id: gameId });
  location.href = 'admin.html';
}

// ---------------- Lobby ----------------
function showLobby() {
  const joinUrl = new URL('./', location.href).href;
  const qr = qrcode(0, 'M');
  qr.addData(joinUrl + '?pin=' + game.pin);
  qr.make();

  app.innerHTML = `
    <div class="host">
      ${header('<span class="logo" style="font-size:2.4rem">Julquiz 🎄</span>')}
      <div class="joinbox">
        <div>
          <div class="muted" style="font-size:1.3rem">Gå till <strong style="color:#fff">${esc(joinUrl.replace(/^https?:\/\//, ''))}</strong> och ange PIN:</div>
          <div class="pin">${esc(game.pin)}</div>
          <div class="muted">…eller skanna QR-koden</div>
        </div>
        <div class="qr">${qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true })}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div class="stat" style="text-align:left"><span id="pcount">0</span><small>deltagare (klicka på ett namn för att ta bort)</small></div>
        <button class="btn" id="startBtn" data-primary disabled style="font-size:1.4rem;padding:18px 34px">Starta quiz ▶</button>
      </div>
      <div class="chips" id="chips"></div>
    </div>`;
  wireEnd();
  $('#startBtn').onclick = () => act('next_question');
  $('#chips').onclick = async e => {
    const id = e.target.closest('.chip')?.dataset.id;
    if (!id) return;
    const p = players.find(x => x.id === id);
    if (p && confirm(`Ta bort ${p.name}?`)) { await sb.rpc('kick_player', { p_player_id: id }); renderChips(); }
  };

  const renderChips = async () => {
    await loadPlayers();
    const box = $('#chips'); if (!box) return;
    const have = new Set($$('.chip', box).map(c => c.dataset.id));
    const want = new Set(players.map(p => p.id));
    $$('.chip', box).forEach(c => { if (!want.has(c.dataset.id)) c.remove(); });
    players.filter(p => !have.has(p.id)).forEach(p => {
      box.insertAdjacentHTML('beforeend', `<button class="chip" data-id="${p.id}">${esc(p.name)}</button>`);
    });
    $('#pcount').textContent = players.length;
    $('#startBtn').disabled = players.length === 0;
  };
  every(renderChips, 1500);
}

// ---------------- Frågan visas (utan alternativ) ----------------
function showIntro() {
  const q = game.current_question;
  app.innerHTML = `
    <div class="host">
      ${header(`Fråga ${q.index + 1} av ${game.total_questions}`)}
      <div class="intro">
        <div class="qtext ${sizeClass(q.text)}">${nl2br(q.text)}</div>
        ${q.image_url ? `<img class="qimg" src="${esc(q.image_url)}" alt="">` : ''}
      </div>
      <div style="text-align:center">
        <button class="btn" data-primary id="showOpts" style="font-size:1.4rem;padding:18px 34px">Visa svarsalternativ ▶</button>
        <p class="muted" style="margin:10px 0 0">Klockan (${q.time_limit} sek) startar när alternativen visas · mellanslag = nästa</p>
      </div>
    </div>`;
  wireEnd();
  $('#showOpts').onclick = () => act('show_options');
}

// ---------------- Fråga ----------------
function optionsHtml(q, reveal) {
  return q.options.map((t, i) => {
    if (!t || !t.trim()) return '';
    const right = reveal && i === reveal.correct_index;
    const dim = reveal && !right;
    return `
      <div class="opt o${i} ${right ? 'right' : ''} ${dim ? 'dim' : ''}">
        <span class="letter">${LETTERS[i]}</span><span>${nl2br(t)}</span>
        ${reveal ? `<span class="count">${reveal.counts?.[i] ?? 0}</span>` : ''}
      </div>`;
  }).join('');
}

function showQuestion() {
  const q = game.current_question;
  app.innerHTML = `
    <div class="host">
      ${header(`Fråga ${q.index + 1} av ${game.total_questions}`)}
      <div class="qtext ${sizeClass(q.text)}">${nl2br(q.text)}</div>
      <div class="mid">
        <div><div class="ring" id="ring"><span id="secs"></span></div></div>
        ${q.image_url ? `<img class="qimg" src="${esc(q.image_url)}" alt="">` : '<div></div>'}
        <div class="stat"><span id="answered">0</span><small>svar</small>
          <button class="btn ghost small" id="skip" data-primary style="margin-top:14px">Visa svar</button></div>
      </div>
      <div class="opts">${optionsHtml(q)}</div>
    </div>`;
  wireEnd();
  $('#skip').onclick = () => doReveal(true);

  let answered = 0;
  loadPlayers();

  every(async () => {
    const { count } = await sb.from('answers').select('player_id', { count: 'exact', head: true })
      .eq('game_id', gameId).eq('question_index', q.index);
    if (count == null || game.status !== 'question') return;
    answered = count;
    const el = $('#answered'); if (el) el.textContent = `${answered}/${players.length}`;
    if (players.length && answered >= players.length) doReveal();
  }, 1000);
  every(loadPlayers, 5000);

  every(() => {
    const ms = remainingMs(game);
    const secs = $('#secs'); if (!secs) return;
    secs.textContent = Math.ceil(ms / 1000);
    $('#ring').style.setProperty('--p', ms / (q.time_limit * 1000));
    if (ms <= 0) setTimeout(doReveal, 600);   // liten marginal för sista svaren
  }, 200);
}

function doReveal(force = false) {
  if (game.status !== 'question' || (revealSent && force !== true)) return;
  revealSent = true;   // automatiken försöker en gång; knappen "Visa svar" kan alltid tvinga
  act('reveal_answer');
}

// ---------------- Rätt svar ----------------
function showReveal() {
  const q = game.current_question;
  const last = q.index + 1 >= game.total_questions;
  const half = isHalfway(q.index);
  const nextLabel = last ? 'Visa slutresultat 🏆' : half ? 'Halvtid – topplista 🎁' : 'Nästa fråga ▶';
  app.innerHTML = `
    <div class="host">
      ${header(`Fråga ${q.index + 1} av ${game.total_questions}`)}
      <div class="qtext ${sizeClass(q.text)}">${nl2br(q.text)}</div>
      <div class="mid">
        <div class="stat">${game.reveal?.answered ?? 0}<small>svarade</small></div>
        ${q.image_url ? `<img class="qimg" src="${esc(q.image_url)}" alt="">` : '<div></div>'}
        <div style="text-align:center"><button class="btn" id="board" data-primary>${nextLabel}</button></div>
      </div>
      <div class="opts">${optionsHtml(q, game.reveal)}</div>
    </div>`;
  wireEnd();
  $('#board').onclick = () => (half ? showLeaderboard() : act('next_question'));
}

/** Topplista efter halva quizet (bara om quizet har minst 3 frågor). */
function isHalfway(index) {
  const n = game.total_questions;
  return n >= 3 && index === Math.ceil(n / 2) - 1;
}

async function showLeaderboard() {
  const { data } = await sb.from('players').select('name, score').eq('game_id', gameId)
    .order('score', { ascending: false }).limit(5);
  app.innerHTML = `
    <div class="host">
      ${header('<span class="logo" style="font-size:2.4rem">Halvtid! 🎁</span>')}
      <div class="board">
        ${(data || []).map((p, i) => `
          <div class="row ${i === 0 ? 'first' : ''}">
            <span class="pos">${i + 1}</span><span>${esc(p.name)}</span><span class="score">${p.score}</span>
          </div>`).join('') || '<p class="muted" style="text-align:center">Inga deltagare</p>'}
      </div>
      <div style="text-align:center;margin-top:auto">
        <button class="btn" id="next" data-primary style="font-size:1.4rem;padding:18px 34px">Nästa fråga ▶</button>
      </div>
    </div>`;
  wireEnd();
  $('#next').onclick = () => act('next_question');
}

// ---------------- Slut ----------------
async function showFinished() {
  const { data } = await sb.from('players').select('name, score').eq('game_id', gameId)
    .order('score', { ascending: false });
  const all = data || [];
  const step = (p, n) => p ? `
    <div class="step p${n}">
      <div class="name">${esc(p.name)}</div>
      <div class="pts">${p.score} p</div>
      <div class="block"><span>${n}</span></div>
    </div>` : '';
  app.innerHTML = `
    <div class="host">
      ${header('<span class="logo" style="font-size:2.4rem">Årets julquizmästare 🎅</span>')}
      <div class="podium">${step(all[1], 2)}${step(all[0], 1)}${step(all[2], 3)}</div>
      <div class="board">
        ${all.slice(3).map((p, i) => `
          <div class="row"><span class="pos">${i + 4}</span><span>${esc(p.name)}</span><span class="score">${p.score}</span></div>`).join('')}
      </div>
      <div style="text-align:center;margin-top:auto">
        <button class="btn danger" id="close" style="font-size:1.2rem">Stäng och radera omgången</button>
      </div>
    </div>`;
  wireEnd();
  $('#close').onclick = endGame;
}

function showGone() {
  app.innerHTML = `
    <div class="center"><div class="panel">
      <h1>Omgången finns inte längre</h1>
      <p class="muted">Den kan ha avslutats eller ersatts av en ny.</p>
      <a class="btn" href="admin.html" style="display:inline-block;text-decoration:none;margin-top:10px">Till admin</a>
    </div></div>`;
}
