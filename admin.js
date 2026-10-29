import { sb, $, $$, esc, LETTERS, errMsg, shrinkImage, QUIZ_NAME, setTitle } from './lib.js';
setTitle('admin');

const app = $('#app');
const TIMES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

init();

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  route();
}
window.addEventListener('hashchange', route);

function route() {
  const m = location.hash.match(/^#quiz=(.+)$/);
  if (m) showEditor(m[1]); else showList();
}

// ---------------- Inloggning ----------------
function showLogin() {
  app.innerHTML = `
    <div class="center">
      <form class="panel" id="login">
        <h1>${esc(QUIZ_NAME)} 🎄</h1>
        <p class="muted">Logga in för att skapa och starta quiz</p>
        <input class="field" type="email" id="email" placeholder="E-post" autocomplete="username" required>
        <input class="field" type="password" id="pw" placeholder="Lösenord" autocomplete="current-password" required>
        <button class="btn" style="width:100%;margin-top:8px">Logga in</button>
        <p class="error" id="err"></p>
      </form>
    </div>`;
  $('#login').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value, password: $('#pw').value });
    if (error) $('#err').textContent = error.message === 'Invalid login credentials' ? 'Fel e-post eller lösenord' : errMsg(error);
    else route();
  };
}

// ---------------- Lista ----------------
async function showList() {
  app.innerHTML = `
    <div class="wrap">
      <div class="adm-head">
        <h1>${esc(QUIZ_NAME)} 🎄</h1>
        <div class="actions">
          <button class="btn ghost small" id="logout">Logga ut</button>
          <button class="btn small" id="new">+ Nytt quiz</button>
        </div>
      </div>
      <div class="list" id="list"><div class="empty">Laddar …</div></div>
    </div>`;
  $('#logout').onclick = async () => { await sb.auth.signOut(); showLogin(); };
  $('#new').onclick = async () => {
    const { data, error } = await sb.from('quizzes').insert({ title: 'Nytt quiz' }).select().single();
    if (error) return alert(errMsg(error));
    location.hash = 'quiz=' + data.id;
  };

  const { data, error } = await sb.from('quizzes')
    .select('id, title, updated_at, questions(count)')
    .order('updated_at', { ascending: false });
  if (error) { $('#list').innerHTML = `<div class="empty">${esc(errMsg(error))}</div>`; return; }
  if (!data.length) { $('#list').innerHTML = `<div class="empty">Inga quiz ännu – klicka på ”Nytt quiz”.</div>`; return; }

  $('#list').innerHTML = data.map(q => {
    const n = q.questions?.[0]?.count ?? 0;
    return `
      <div class="item" data-id="${q.id}">
        <div class="title">${esc(q.title)}<div class="meta">${n} ${n === 1 ? 'fråga' : 'frågor'}</div></div>
        <button class="btn ghost small" data-act="edit">Redigera</button>
        <button class="btn ghost small" data-act="del">Ta bort</button>
        <button class="btn small" data-act="start" ${n ? '' : 'disabled'}>▶ Starta</button>
      </div>`;
  }).join('');

  $$('#list .item').forEach(row => row.onclick = async e => {
    const act = e.target.dataset.act; const id = row.dataset.id;
    if (act === 'edit') location.hash = 'quiz=' + id;
    if (act === 'start') startGame(id, e.target);
    if (act === 'del' && confirm('Ta bort quizet och alla dess frågor?')) {
      const { error } = await sb.from('quizzes').delete().eq('id', id);
      if (error) alert(errMsg(error)); else showList();
    }
  });
}

async function startGame(quizId, btn) {
  if (btn) btn.disabled = true;
  const { data, error } = await sb.rpc('create_game', { p_quiz_id: quizId });
  if (btn) btn.disabled = false;
  if (error) return alert(errMsg(error));
  location.href = 'host.html?game=' + data.id;
}

// ---------------- Redigera quiz ----------------
let quiz = null;
let questions = [];
const timers = new Map();
const waiting = new Set();   // ändringar som väntar på att sparas
let pending = 0;             // sparningar på väg till servern

function setSaved(text) { const el = $('#saved'); if (el) el.textContent = text; }
function trackSave(promise) {
  pending++; setSaved('Sparar …');
  return promise.then(r => {
    pending--;
    if (r?.error) { setSaved('⚠ Kunde inte spara: ' + errMsg(r.error)); return r; }
    if (!pending && !waiting.size) setSaved('Allt sparat ✓');
    return r;
  });
}
const touchQuiz = () => sb.from('quizzes').update({ updated_at: new Date().toISOString() }).eq('id', quiz.id);

async function showEditor(id) {
  app.innerHTML = `<div class="wrap"><div class="empty">Laddar …</div></div>`;
  const [{ data: z, error: e1 }, { data: qs, error: e2 }] = await Promise.all([
    sb.from('quizzes').select('*').eq('id', id).single(),
    sb.from('questions').select('*').eq('quiz_id', id).order('position').order('id'),
  ]);
  if (e1 || e2) { app.innerHTML = `<div class="wrap"><div class="empty">${esc(errMsg(e1 || e2))}</div></div>`; return; }
  quiz = z; questions = qs;

  app.innerHTML = `
    <div class="wrap">
      <div class="adm-head">
        <button class="btn ghost small" id="back">← Mina quiz</button>
        <div class="actions">
          <span class="saved" id="saved">Allt sparat ✓</span>
          <button class="btn small" id="start">▶ Starta quiz</button>
        </div>
      </div>
      <input class="title-input" id="title" value="${esc(quiz.title)}" placeholder="Quizets namn">
      <div class="list" id="qs"></div>
      <button class="btn ghost" id="add" style="width:100%;margin-top:14px">+ Lägg till fråga</button>
    </div>`;

  $('#back').onclick = () => { location.hash = ''; };
  $('#start').onclick = e => {
    const bad = questions.findIndex(q => problems(q).length);
    if (!questions.length) return alert('Lägg till minst en fråga först.');
    if (bad >= 0 && !confirm(`Fråga ${bad + 1} har problem (${problems(questions[bad]).join(', ')}). Starta ändå?`)) return;
    startGame(quiz.id, e.target);
  };
  $('#title').oninput = e => debounce('title', () =>
    trackSave(sb.from('quizzes').update({ title: e.target.value || 'Namnlöst quiz', updated_at: new Date().toISOString() }).eq('id', quiz.id)));
  $('#add').onclick = addQuestion;

  renderQuestions();
  if (!questions.length) addQuestion();
}

function problems(q) {
  const p = [];
  if (!q.text.trim() && !q.image_url) p.push('ingen frågetext');
  if (q.options.filter(o => o.trim()).length < 2) p.push('färre än 2 svarsalternativ');
  if (!q.options[q.correct_index]?.trim()) p.push('rätt svar är tomt');
  return p;
}

function debounce(key, fn, ms = 600) {
  clearTimeout(timers.get(key));
  waiting.add(key);
  setSaved('Sparar …');
  timers.set(key, setTimeout(() => { waiting.delete(key); fn(); }, ms));
}

// Varna om man stänger sidan innan allt hunnit sparas
window.addEventListener('beforeunload', e => { if (pending || waiting.size) e.preventDefault(); });

function saveQuestion(q) {
  debounce(q.id, () => {
    trackSave(sb.from('questions').update({
      text: q.text, options: q.options, correct_index: q.correct_index, time_limit: q.time_limit, image_url: q.image_url,
    }).eq('id', q.id));
    touchQuiz();
  });
}

async function addQuestion() {
  const position = questions.length ? Math.max(...questions.map(q => q.position)) + 1 : 0;
  const { data, error } = await trackSave(sb.from('questions')
    .insert({ quiz_id: quiz.id, position, text: '', options: ['', '', '', ''], correct_index: 0, time_limit: 20 })
    .select().single());
  if (error) return;
  questions.push(data);
  renderQuestions();
  $$('.qcard .qtxt').at(-1)?.focus();
  touchQuiz();
}

function renderQuestions() {
  const box = $('#qs');
  box.innerHTML = questions.map((q, i) => `
    <div class="qcard" data-id="${q.id}">
      <div class="qhead">
        <strong>Fråga ${i + 1}</strong>
        <div class="tools">
          <select data-f="time" title="Tid att svara">
            ${TIMES.map(t => `<option value="${t}" ${t === q.time_limit ? 'selected' : ''}>${t} sek</option>`).join('')}
            ${TIMES.includes(q.time_limit) ? '' : `<option selected value="${q.time_limit}">${q.time_limit} sek</option>`}
          </select>
          <button class="iconbtn" data-act="up" title="Flytta upp" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="iconbtn" data-act="down" title="Flytta ner" ${i === questions.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="iconbtn" data-act="del" title="Ta bort">🗑</button>
        </div>
      </div>
      <textarea class="qtxt" data-f="text" placeholder="Skriv frågan – hur lång som helst">${esc(q.text)}</textarea>
      <div class="imgrow">
        ${q.image_url ? `<img src="${esc(q.image_url)}" alt=""><button class="btn ghost small" data-act="rmimg">Ta bort bild</button>`
                      : `<label class="btn ghost small">🖼 Lägg till bild<input type="file" accept="image/*" data-f="img" hidden></label>`}
        <span class="muted" data-upload></span>
      </div>
      <div class="aopts">
        ${q.options.map((o, k) => `
          <div class="aopt o${k}">
            <label title="Markera som rätt svar">
              <input type="radio" name="c-${q.id}" value="${k}" data-f="correct" ${k === q.correct_index ? 'checked' : ''}>
              ${k === q.correct_index ? 'RÄTT' : LETTERS[k]}
            </label>
            <textarea data-f="opt" data-k="${k}" placeholder="Alternativ ${LETTERS[k]}${k > 1 ? ' (valfritt)' : ''}">${esc(o)}</textarea>
          </div>`).join('')}
      </div>
      <div class="warn" data-warn>${esc(problems(q).join(' · '))}</div>
    </div>`).join('');

  $$('.qcard', box).forEach(card => wireCard(card));
  $$('textarea', box).forEach(autosize);
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

function wireCard(card) {
  const q = questions.find(x => x.id === card.dataset.id);
  const refreshWarn = () => { $('[data-warn]', card).textContent = problems(q).join(' · '); };

  card.addEventListener('input', e => {
    if (e.target.tagName === 'TEXTAREA') autosize(e.target);
    const f = e.target.dataset.f;
    if (f === 'text') q.text = e.target.value;
    else if (f === 'opt') q.options[Number(e.target.dataset.k)] = e.target.value;
    else return;
    refreshWarn(); saveQuestion(q);
  });

  card.addEventListener('change', async e => {
    const f = e.target.dataset.f;
    if (f === 'time') { q.time_limit = Number(e.target.value); saveQuestion(q); }
    if (f === 'correct') { q.correct_index = Number(e.target.value); saveQuestion(q); renderQuestions(); }
    if (f === 'img' && e.target.files[0]) uploadImage(q, e.target.files[0], card);
  });

  card.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const i = questions.indexOf(q);
    if (act === 'del') {
      if (!confirm('Ta bort frågan?')) return;
      await trackSave(sb.from('questions').delete().eq('id', q.id));
      if (q.image_url) removeStoredImage(q.image_url);
      questions.splice(i, 1); renderQuestions(); touchQuiz();
    }
    if (act === 'up' || act === 'down') {
      const j = act === 'up' ? i - 1 : i + 1;
      [questions[i], questions[j]] = [questions[j], questions[i]];
      questions.forEach((x, n) => x.position = n);
      renderQuestions();
      await Promise.all([questions[i], questions[j]].map(x =>
        trackSave(sb.from('questions').update({ position: x.position }).eq('id', x.id))));
    }
    if (act === 'rmimg') {
      removeStoredImage(q.image_url);
      q.image_url = null; saveQuestion(q); renderQuestions();
    }
  });
}

async function uploadImage(q, file, card) {
  const status = $('[data-upload]', card);
  status.textContent = 'Laddar upp …';
  try {
    const small = await shrinkImage(file);
    const ext = (small.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${quiz.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('quiz-images').upload(path, small, { contentType: small.type, upsert: false });
    if (error) throw error;
    if (q.image_url) removeStoredImage(q.image_url);
    q.image_url = sb.storage.from('quiz-images').getPublicUrl(path).data.publicUrl;
    saveQuestion(q);
    renderQuestions();
  } catch (err) {
    status.textContent = '⚠ ' + errMsg(err);
  }
}

function removeStoredImage(url) {
  const marker = '/quiz-images/';
  const i = url?.indexOf(marker);
  if (i > -1) sb.storage.from('quiz-images').remove([decodeURIComponent(url.slice(i + marker.length))]);
}
