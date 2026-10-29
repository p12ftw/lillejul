import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const LETTERS = ['A', 'B', 'C', 'D'];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const nl2br = s => esc(s).replace(/\n/g, '<br>');

export function errMsg(e) {
  return (e && (e.message || e.error_description)) || 'Något gick fel';
}

/** Teckenstorlek efter textlängd – så långa frågor ändå får plats. */
export function sizeClass(text) {
  const n = String(text || '').length;
  if (n < 60) return 'len-s';
  if (n < 160) return 'len-m';
  if (n < 350) return 'len-l';
  return 'len-xl';
}

// ---- Synka klockan mot servern så nedräkningen stämmer ----
let clockOffset = 0;
export async function syncClock() {
  try {
    const t0 = Date.now();
    const { data } = await sb.rpc('server_time');
    const t1 = Date.now();
    if (data) clockOffset = new Date(data).getTime() - (t0 + t1) / 2;
  } catch { /* lokal klocka får duga */ }
}
export const serverNow = () => Date.now() + clockOffset;

export function remainingMs(game) {
  const q = game?.current_question;
  if (!q || !game.question_started_at) return 0;
  const elapsed = serverNow() - new Date(game.question_started_at).getTime();
  return Math.max(0, Math.min(q.time_limit * 1000, q.time_limit * 1000 - elapsed));
}

/**
 * Följ ett spels läge. Realtid för snabbhet + polling som reserv
 * (mobiler som somnar, tappat nät m.m.). onChange(null) = spelet raderat.
 */
export function watchGame(gameId, onChange, pollMs = 3000) {
  let stopped = false;
  const fetchNow = async () => {
    if (stopped) return;
    const { data, error } = await sb.from('games').select('*').eq('id', gameId).maybeSingle();
    if (!error && !stopped) onChange(data);
  };
  const channel = sb.channel('game-' + gameId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, p => {
      if (stopped) return;
      if (p.eventType === 'DELETE') onChange(null);
      else onChange(p.new);
    })
    .subscribe(status => { if (status === 'SUBSCRIBED') fetchNow(); });
  const timer = setInterval(fetchNow, pollMs);
  const onVis = () => { if (!document.hidden) fetchNow(); };
  document.addEventListener('visibilitychange', onVis);
  fetchNow();
  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
    sb.removeChannel(channel);
  };
}

/** Förminska stora bilder innan uppladdning (mobilfoton blir annars flera MB). */
export async function shrinkImage(file, maxSide = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 800_000) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise(r => c.toBlob(r, type, 0.85));
  return blob && blob.size < file.size ? new File([blob], file.name, { type }) : file;
}

/** Snöfall i bakgrunden (stängs av om användaren valt reducerade animationer). */
export function letItSnow(count = 36) {
  if (document.querySelector('.snow')) return;
  const box = document.createElement('div');
  box.className = 'snow';
  box.setAttribute('aria-hidden', 'true');
  const flakes = ['❄', '❅', '•', '•', '·'];
  for (let i = 0; i < count; i++) {
    const f = document.createElement('i');
    f.textContent = flakes[i % flakes.length];
    const size = 8 + Math.random() * 14;
    f.style.left = Math.random() * 100 + 'vw';
    f.style.fontSize = size + 'px';
    f.style.opacity = (0.35 + Math.random() * 0.5).toFixed(2);
    f.style.setProperty('--drift', (Math.random() * 80 - 40) + 'px');
    f.style.animationDuration = (9 + Math.random() * 12) + 's';
    f.style.animationDelay = (-Math.random() * 20) + 's';
    box.appendChild(f);
  }
  document.body.prepend(box);
}
