// Aura frontend: chat state, streaming, Markdown rendering, sidebar, theme.
const $ = s => document.querySelector(s);
const ICON = {
  send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.5-7.6a1 1 0 000-1.8L3.4 3.4a1 1 0 00-1.4 1.2L4 11l8 1-8 1-2 6.2a1 1 0 001.4 1.2z"/></svg>',
  stop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  spk: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 010 7"/></svg>',
  del: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>'
};
const SUGGESTIONS = [
  ['Explain black holes', 'in simple language'], ['Make me a game', 'a small one in HTML & JavaScript'],
  ['Explain the offside rule', 'with football examples'], ['Help me with maths', 'solve 3x + 7 = 22 step by step'],
  ['Translate to Spanish', '"Where is the train station?"'], ['Create an image', 'a cat astronaut on the moon']
];

let chats = [], cur = null, busy = false, ctrl = null, file = null, sb = null, guest = false, warned = false;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
// Saves to the browser (local mode) or to the user's cloud account (login mode).
const strip = m => m.image ? { ...m, image: { prompt: m.image.prompt, seed: m.image.seed, cf: m.image.cf } } : m; // never store the picture bytes
const save = c => {
  if (guest) return; // guests: nothing is saved
  if (!sb) { try { localStorage.setItem('nova.chats', JSON.stringify(chats.map(x => ({ ...x, messages: x.messages.map(strip) })))); } catch {} return; }
  c = c || chat();
  if (c && c.messages.length) sb.from('chats').upsert({ id: c.id, title: c.title, messages: c.messages.map(strip), updated: c.updated })
    .then(({ error }) => { if (error) { console.error(error); if (!warned) { warned = true; alert('Could not save your chat online: ' + error.message); } } });
};
const chat = () => chats.find(c => c.id === cur);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Markdown ----------
function inline(s) {
  s = esc(s);
  const codes = []; s = s.replace(/`([^`\n]+)`/g, (_, c) => (codes.push(c), `\u0000${codes.length - 1}\u0000`));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
       .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}
function blocks(t) {
  const out = []; let list = null, para = [];
  const flush = () => { if (para.length) out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`); para = []; };
  const close = () => { if (list) out.push(`</${list}>`); list = null; };
  for (const line of t.split('\n')) {
    let m;
    if (!line.trim()) { flush(); close(); }
    else if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flush(); close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = line.match(/^\s*[-*+]\s+(.*)/))) { flush(); if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flush(); if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^>\s?(.*)/))) { flush(); close(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else { close(); para.push(line); }
  }
  flush(); close(); return out.join('');
}
function md(src) {
  return src.split('```').map((p, i) => {
    if (i % 2 === 0) return blocks(p);
    const nl = p.indexOf('\n'), lang = nl > -1 ? p.slice(0, nl).trim() : '', code = nl > -1 ? p.slice(nl + 1) : '';
    return `<div class="code"><div class="ch"><span>${esc(lang || 'code')}</span><button class="cc">Copy</button></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`;
  }).join('');
}

// ---------- Rendering ----------
function renderList() {
  const l = $('#list'); l.innerHTML = '';
  [...chats].sort((a, b) => b.updated - a.updated).forEach(c => {
    const d = document.createElement('div'); d.className = 'item' + (c.id === cur ? ' on' : '');
    d.innerHTML = `<span></span><div class="acts"><button class="mini" data-a="ren" title="Rename">${ICON.edit}</button><button class="mini" data-a="del" title="Delete">${ICON.del}</button></div>`;
    d.firstChild.textContent = c.title;
    d.onclick = e => {
      const a = e.target.closest('[data-a]');
      if (!a) { if (!busy) open(c.id); closeSide(); }
      else if (a.dataset.a === 'del') { if (!busy && confirm('Delete this chat?')) remove(c.id); }
      else rename(c, d);
    };
    l.appendChild(d);
  });
}
function rename(c, d) {
  const i = document.createElement('input'); i.value = c.title; d.firstChild.replaceWith(i); i.focus(); i.select();
  const done = () => { c.title = i.value.trim() || c.title; save(c); renderList(); if (c.id === cur) $('#title').textContent = c.title; };
  i.onkeydown = e => { if (e.key === 'Enter') done(); if (e.key === 'Escape') renderList(); };
  i.onblur = done; i.onclick = e => e.stopPropagation();
}
function msgEl(m, i) {
  const d = document.createElement('div'); d.className = 'msg ' + (m.role === 'user' ? 'user' : 'ai'); d.dataset.i = i;
  if (m.role === 'user') {
    d.innerHTML = '<div class="bubble"></div>';
    d.firstChild.textContent = m.content;
    if (m.file) d.firstChild.insertAdjacentHTML('afterbegin', `<div class="file">📎 ${esc(m.file.name)}</div>`);
  } else {
    d.innerHTML = `<div class="av"></div><div class="bubble"><div class="body"></div><div class="acts2"><button class="icon cp" title="Copy response">${ICON.copy}</button><button class="icon rd" title="Read aloud">${ICON.spk}</button><button class="icon pres" title="Show as slides" style="display:none">▶ Present</button></div></div>`;
    m.image ? fillImage(d, m) : fillAI(d, m, false);
  }
  return d;
}
function fillAI(d, m, streaming) {
  const body = d.querySelector('.body');
  if (!m.content && streaming) body.innerHTML = '<div class="dots"><i></i><i></i><i></i></div>';
  else { body.innerHTML = md(m.content); body.classList.toggle('cur', streaming); }
  d.querySelector('.acts2').style.display = m.content && !streaming ? '' : 'none';
  const pr = d.querySelector('.pres'); if (pr) pr.style.display = m.mode === 'slides' && m.content && !streaming ? '' : 'none';
  const old = d.querySelector('.err'); if (old) old.remove();
  if (m.error) {
    const e = document.createElement('div'); e.className = 'err';
    e.innerHTML = `<span>⚠️ ${esc(m.error)}</span><button>Retry</button>`;
    e.querySelector('button').onclick = () => { if (!busy) { const c = chat(); c.messages.pop(); generate(c); } };
    d.querySelector('.bubble').appendChild(e);
  }
}
function renderChat() {
  const box = $('#msgs'), c = chat(); box.innerHTML = '';
  $('#title').textContent = c ? c.title : 'New chat';
  if (!c || !c.messages.length) {
    box.innerHTML = `<div class="welcome"><span class="logo"></span><h1>Hi, I'm Aura</h1><p>Ask me anything — maths, science, code, football, games, writing and more.</p><div class="sug"></div></div>`;
    SUGGESTIONS.forEach(([t, s]) => {
      if (guest && t === 'Create an image') return; // images are for logged-in users only
      const b = document.createElement('button'); b.innerHTML = `<b>${esc(t)}</b><small>${esc(s)}</small>`;
      b.onclick = () => t === 'Create an image' ? makeImage(s) : send(t + (s.startsWith('"') ? ': ' + s : ' — ' + s));
      box.querySelector('.sug').appendChild(b);
    });
  } else c.messages.forEach((m, i) => box.appendChild(msgEl(m, i)));
  $('#scroll').scrollTop = 1e9;
}

// ---------- Chat actions ----------
function open(id) { stopSpeaking(); cur = id; localStorage.setItem('nova.cur', id); renderList(); renderChat(); }
function newChat() {
  if (busy) return;
  const c = chat(); if (c && !c.messages.length) { renderChat(); return; }
  const n = { id: uid(), title: 'New chat', messages: [], updated: Date.now() };
  chats.push(n); save(); open(n.id); $('#input').focus();
}
function remove(id) {
  chats = chats.filter(c => c.id !== id); save();
  if (sb) sb.from('chats').delete().eq('id', id).then(({ error }) => { if (error) alert('Could not delete online: ' + error.message); });
  if (cur === id) { cur = null; localStorage.removeItem('nova.cur'); } 
  renderList(); renderChat();
}
function setBusy(b) {
  busy = b; const s = $('#send'); s.innerHTML = b ? ICON.stop : ICON.send; s.disabled = !b && !$('#input').value.trim() && !file;
}
async function send(text) {
  text = (text ?? $('#input').value).trim();
  if (busy || (!text && !file)) return;
  if (!file && (mode === 'image' || /^\/image\s+/i.test(text))) return makeImage(text);
  let c = chat();
  if (!c) { c = { id: uid(), title: 'New chat', messages: [], updated: Date.now() }; chats.push(c); cur = c.id; localStorage.setItem('nova.cur', cur); }
  const m = { role: 'user', content: text || 'Please look at the attached file.' };
  if (file) { m.file = file; file = null; $('#chip').hidden = true; }
  if (!c.messages.length) c.title = (text || m.file.name).slice(0, 40);
  c.messages.push(m);
  $('#input').value = ''; autosize();
  generate(c);
}
const apiText = m => m.file ? `${m.content}\n\n[Attached file: ${m.file.name}]\n\`\`\`\n${m.file.text}\n\`\`\`` : m.content;

async function generate(c) {
  stopSpeaking();
  const m0 = mode && mode !== 'image' ? mode : null;
  const ai = { role: 'assistant', content: '' }; if (m0) ai.mode = m0; c.messages.push(ai); c.updated = Date.now();
  renderList(); renderChat(); setBusy(true);
  const el = $('#msgs').lastElementChild; let raf = 0;
  const paint = () => { raf = 0; const near = $('#scroll').scrollHeight - $('#scroll').scrollTop - $('#scroll').clientHeight < 140; fillAI(el, ai, true); if (near) $('#scroll').scrollTop = 1e9; };
  ctrl = new AbortController();
  try {
    const history = c.messages.slice(0, -1).filter(m => m.role === 'user' || m.content).map(m => ({ role: m.role, content: apiText(m) }));
    const headers = { 'Content-Type': 'application/json' };
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (!data.session) throw new Error('Your login expired. Please refresh the page and log in again.');
      headers.Authorization = 'Bearer ' + data.session.access_token;
    }
    const res = await fetch('/api/chat', { method: 'POST', headers, body: JSON.stringify({ messages: history, mode: m0 }), signal: ctrl.signal });
    if (!res.ok) { let e = `Server error (${res.status})`; try { e = (await res.json()).error || e; } catch {} throw new Error(e); }
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
        if (!line.startsWith('data:')) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.error) throw new Error(ev.error);
        if (ev.t) { ai.content += ev.t; if (!raf) raf = requestAnimationFrame(paint); }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') ai.error = e instanceof TypeError ? 'Network error — check your internet connection and that the server is running.' : e.message;
  }
  cancelAnimationFrame(raf); ctrl = null;
  if (!ai.content && !ai.error) c.messages.pop(); // stopped before any output
  c.updated = Date.now(); save(); setBusy(false);
  if (ai.content || ai.error) fillAI(el, ai, false); else renderChat();
  renderList();
  if (auto && ai.content && !ai.error) speak(ai.content, el.querySelector('.rd'));
}
const stop = () => ctrl && ctrl.abort();

// ---------- UI wiring ----------
function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 200) + 'px'; if (!busy) $('#send').disabled = !t.value.trim() && !file; }
$('#input').addEventListener('input', autosize);
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$('#send').onclick = () => busy ? stop() : send();
$('#new').onclick = () => { newChat(); closeSide(); };
$('#attach').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size > 200000) return alert('Please choose a text file under 200 KB.');
  file = { name: f.name, text: await f.text() };
  const ch = $('#chip'); ch.hidden = false; ch.innerHTML = `📎 ${esc(f.name)} <button class="mini" title="Remove">✕</button>`;
  ch.querySelector('button').onclick = () => { file = null; ch.hidden = true; autosize(); };
  autosize(); $('#input').focus();
};
$('#msgs').addEventListener('click', e => {
  const pb = e.target.closest('.pres');
  if (pb) return openDeck(chat().messages[pb.closest('.msg').dataset.i].content);
  const ib = e.target.closest('.imgre, .imgdl');
  if (ib) {
    const el = ib.closest('.msg'), m = chat().messages[el.dataset.i];
    if (ib.classList.contains('imgre')) { m.image.seed = Math.floor(Math.random() * 1e6); m.image.data = null; m.image.fresh = true; save(chat()); fillImage(el, m); }
    else downloadImage(m.image);
    return;
  }
  const flash = (b, t) => { const o = b.innerHTML; b.textContent = t; setTimeout(() => b.innerHTML = o, 1200); };
  const cc = e.target.closest('.cc'), cp = e.target.closest('.cp'), rd = e.target.closest('.rd');
  if (rd) { if (rdBtn === rd) stopSpeaking(); else speak(chat().messages[rd.closest('.msg').dataset.i].content, rd); }
  if (cc) navigator.clipboard.writeText(cc.closest('.code').querySelector('code').textContent).then(() => flash(cc, 'Copied!'));
  if (cp) navigator.clipboard.writeText(chat().messages[cp.closest('.msg').dataset.i].content).then(() => flash(cp, '✓'));
});
const openSide = () => { $('#side').classList.add('open'); $('#scrim').classList.add('open'); };
const closeSide = () => { $('#side').classList.remove('open'); $('#scrim').classList.remove('open'); };
$('#menu').onclick = openSide; $('#scrim').onclick = closeSide;
function theme(t) { document.documentElement.dataset.theme = t; localStorage.setItem('nova.theme', t); $('#themeLabel').textContent = t === 'dark' ? 'Light mode' : 'Dark mode'; }
$('#theme').onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
theme(localStorage.getItem('nova.theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

// ---------- Images (free Pollinations service; the browser loads the picture directly) ----------
let mode = null, useCF = false;
const GUEST_IMG_MSG = 'Please log in to use the tools. Guests can chat, but the tools menu is for people with an account.';
async function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (sb) { const { data } = await sb.auth.getSession(); if (data.session) h.Authorization = 'Bearer ' + data.session.access_token; }
  return h;
}
const imgUrl = i => `https://image.pollinations.ai/prompt/${encodeURIComponent(i.prompt)}?width=1024&height=1024&model=flux&nologo=true&private=true&seed=${i.seed}`;
// ---------- Tools menu (modes) ----------
const MODES = {
  image:    { icon: '🎨', label: 'Create an image', sub: 'Draw anything from a description', hint: 'Describe the image you want…' },
  song:     { icon: '🎵', label: 'Make a song', sub: 'Original lyrics, style and chords', hint: 'What should the song be about?' },
  code:     { icon: '💻', label: 'Code', sub: 'Write and fix programs', hint: 'What should we build or fix?' },
  write:    { icon: '✍️', label: 'Write', sub: 'Essays, emails, stories, speeches', hint: 'What should I write?' },
  slides:   { icon: '📊', label: 'Make slides', sub: 'A presentation you can play full screen', hint: 'What is the presentation about?' },
  research: { icon: '🔎', label: 'Deep research', sub: 'Thorough report (no live web search)', hint: 'What should I research?' },
  learn:    { icon: '🎓', label: 'Guided learning', sub: 'Learn step by step with questions', hint: 'What do you want to learn?' }
};
function setMode(m) {
  mode = m || null;
  const chip = $('#mode'), info = MODES[mode];
  chip.hidden = !info;
  if (info) { chip.innerHTML = `${info.icon} ${esc(info.label)} <button class="mini" title="Turn off">✕</button>`; chip.querySelector('button').onclick = () => setMode(null); }
  $('#toolbtn').classList.toggle('on', !!info);
  $('#input').placeholder = info ? info.hint : 'Message Aura…';
  $('#tools').hidden = true;
  if (info) $('#input').focus();
}
function buildTools() {
  const t = $('#tools'); t.innerHTML = '';
  Object.entries(MODES).forEach(([k, v]) => {
    const locked = guest; // guests cannot use any tool
    const b = document.createElement('button'); b.className = 'tool' + (k === mode ? ' on' : '') + (locked ? ' lock' : '');
    b.innerHTML = `<span class="ti">${v.icon}</span><span><b>${esc(v.label)}${locked ? ' 🔒' : ''}</b><small>${esc(locked ? 'Log in to use this' : v.sub)}</small></span>`;
    b.onclick = () => locked ? (t.hidden = true, alert(GUEST_IMG_MSG)) : setMode(k === mode ? null : k);
    t.appendChild(b);
  });
}
$('#toolbtn').onclick = e => { e.stopPropagation(); const t = $('#tools'); if (t.hidden) buildTools(); t.hidden = !t.hidden; };
document.addEventListener('click', e => { if (!e.target.closest('#tools')) $('#tools').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#tools').hidden = true; });

// ---------- Slides viewer ----------
function openDeck(text) {
  const slides = text.split(/^##\s+/m).slice(1).map(p => { const nl = p.indexOf('\n'); return { title: (nl < 0 ? p : p.slice(0, nl)).trim(), body: nl < 0 ? '' : p.slice(nl + 1) }; });
  if (!slides.length) return alert('I could not find any slides in this answer.');
  let i = 0; const d = $('#deck'); d.hidden = false;
  const close = () => { d.hidden = true; d.innerHTML = ''; document.removeEventListener('keydown', key); };
  const draw = () => {
    const s = slides[i];
    d.innerHTML = `<div class="slide"><h2>${inline(s.title)}</h2><div>${md(s.body)}</div></div><div class="deckbar"><button data-d="-1">◀ Back</button><span>${i + 1} / ${slides.length}</span><button data-d="1">Next ▶</button><button data-d="x">✕ Close</button></div>`;
  };
  const go = n => { i = Math.max(0, Math.min(slides.length - 1, i + n)); draw(); };
  const key = e => { if (e.key === 'ArrowRight' || e.key === ' ') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') close(); };
  d.onclick = e => { const b = e.target.closest('button'); if (!b) return; b.dataset.d === 'x' ? close() : go(+b.dataset.d); };
  document.addEventListener('keydown', key); draw();
}

function makeImage(prompt) {
  prompt = prompt.replace(/^\/image\s+/i, '').trim().slice(0, 500);
  if (guest) return alert(GUEST_IMG_MSG);
  if (busy || !prompt) return;
  setMode(null);
  let c = chat();
  if (!c) { c = { id: uid(), title: 'New chat', messages: [], updated: Date.now() }; chats.push(c); cur = c.id; localStorage.setItem('nova.cur', cur); }
  if (!c.messages.length) c.title = ('🎨 ' + prompt).slice(0, 40);
  c.messages.push({ role: 'user', content: '🎨 Create an image: ' + prompt });
  c.messages.push({ role: 'assistant', content: `(Aura created an image of: ${prompt})`, image: { prompt, seed: Math.floor(Math.random() * 1e6), cf: useCF, fresh: true } });
  c.updated = Date.now(); $('#input').value = ''; autosize();
  save(c); renderList(); renderChat();
}
async function fillImage(d, m) {
  const body = d.querySelector('.body'), acts = d.querySelector('.acts2');
  body.classList.remove('cur'); acts.style.display = 'none';
  acts.innerHTML = '<button class="icon imgre" title="Make a new version">🔄 New version</button><button class="icon imgdl" title="Download this image">⬇ Download</button>';
  body.innerHTML = '<div class="imgwrap"><div class="imgload"><div class="dots"><i></i><i></i><i></i></div>Creating your image… this can take up to 30 seconds</div></div>';
  let done = false;
  const fail = msg => { if (done) return; done = true; body.innerHTML = `<div class="imgwrap"><div class="err"><span>⚠️ ${esc(msg)}</span></div></div>`; acts.style.display = ''; };
  const show = (src, timer) => {
    const img = new Image(); img.className = 'genimg'; img.alt = m.image.prompt;
    img.onload = () => { if (done) return; done = true; clearTimeout(timer); body.innerHTML = '<div class="imgwrap"></div>'; body.firstChild.appendChild(img); acts.style.display = ''; };
    img.onerror = () => { clearTimeout(timer); fail('The image service did not respond. It may be busy. Please try again in a moment.'); };
    img.src = src;
  };
  if (m.image.cf) { // fast service (Cloudflare) through our own server
    if (m.image.data) return show(m.image.data);
    if (!m.image.fresh) return fail('This picture was not saved. Tap "New version" to make it again.');
    try {
      const res = await fetch('/api/image', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ prompt: m.image.prompt }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.image) throw new Error(j.error || 'Image service error');
      m.image.data = 'data:image/jpeg;base64,' + j.image; show(m.image.data);
    } catch (e) { fail(e instanceof TypeError ? 'Network error. Check your internet connection.' : e.message); }
  } else { // free fallback (Pollinations): can be slow, so stop waiting after 45 seconds
    const timer = setTimeout(() => fail('The free image service is too busy right now. Please try again in a minute.'), 45000);
    show(imgUrl(m.image), timer);
  }
}
function downloadImage(i) {
  const url = i.data || imgUrl(i);
  fetch(url).then(r => r.blob()).then(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'aura-image.jpg'; a.click(); })
    .catch(() => window.open(url, '_blank')); // if the browser blocks the direct download, open it so you can save it
}

// ---------- Voice: speech in (mic) and speech out (read aloud) ----------
const synth = window.speechSynthesis;
let rdBtn = null, speakId = 0, auto = localStorage.getItem('nova.auto') === '1';
const plain = s => s.replace(/```[\s\S]*?```/g, ' (code block) ').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*_>~|]/g, '').replace(/\s+/g, ' ').trim();
function stopSpeaking() { speakId++; if (synth) synth.cancel(); if (rdBtn) rdBtn.classList.remove('on'); rdBtn = null; }
function speak(text, btn) {
  if (!synth) return;
  stopSpeaking();
  // Split into short chunks: some browsers cut off long utterances.
  const parts = (plain(text).match(/[^.!?]+[.!?]*\s*/g) || []).reduce((a, s) => { if (a.length && (a[a.length - 1] + s).length < 220) a[a.length - 1] += s; else a.push(s); return a; }, []);
  if (!parts.length) return;
  const id = speakId; rdBtn = btn || null; if (btn) btn.classList.add('on');
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    if (i === parts.length - 1) u.onend = u.onerror = () => { if (id === speakId) stopSpeaking(); };
    synth.speak(u);
  });
}
if (!synth) { document.body.classList.add('nosynth'); $('#auto').hidden = true; }
const paintAuto = () => $('#autoLabel').textContent = 'Auto-read replies: ' + (auto ? 'On' : 'Off');
$('#auto').onclick = () => { auto = !auto; localStorage.setItem('nova.auto', auto ? '1' : '0'); paintAuto(); if (!auto) stopSpeaking(); };
paintAuto();

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (!SR) $('#mic').hidden = true; // e.g. Firefox has no speech recognition
$('#mic').onclick = () => {
  if (rec) return rec.stop();
  stopSpeaking();
  const base = $('#input').value.trim();
  rec = new SR(); rec.lang = navigator.language || 'en-GB'; rec.interimResults = true;
  rec.onresult = e => { const t = [...e.results].map(r => r[0].transcript).join(' ').trim(); $('#input').value = (base ? base + ' ' : '') + t; autosize(); };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') alert('The microphone is blocked. Allow microphone access for this site in your browser settings, then try again.');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') alert('Voice input problem: ' + e.error);
  };
  rec.onend = () => { rec = null; $('#mic').classList.remove('rec'); $('#input').focus(); };
  try { rec.start(); $('#mic').classList.add('rec'); } catch { rec = null; }
};

// ---------- Accounts (only active when the server has Supabase configured) ----------
function showAuth(msg, fatal) {
  const a = $('#auth'); a.hidden = false;
  a.innerHTML = `<div class="card"><span class="logo"></span><h2>Welcome to Aura</h2><p>Log in so your chats are saved to your own account and open on any device.</p>
    ${fatal ? '' : '<input id="em" type="email" placeholder="Email" autocomplete="email"><input id="pw" type="password" placeholder="Password (6+ characters)" autocomplete="current-password"><div class="row"><button id="li" class="new">Log in</button><button id="su" class="alt">Create account</button></div>'}
    <div id="aerr" class="aerr"></div>
    <button id="gu" class="alt">Continue as guest</button><small class="gnote">Guests can chat, but chats are not saved and disappear when you refresh.</small></div>`;
  const err = t => $('#aerr').textContent = t; if (msg) err(msg);
  $('#gu').onclick = () => { sessionStorage.setItem('nova.guest', '1'); location.reload(); };
  if (fatal) return;
  const go = async mode => {
    const email = $('#em').value.trim(), password = $('#pw').value;
    if (!email || password.length < 6) return err('Enter your email and a password of at least 6 characters.');
    err(mode === 'su' ? 'Creating your account…' : 'Logging in…');
    const { data, error } = mode === 'su' ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
    if (error) return err(error.message);
    if (data.session) { sessionStorage.removeItem('nova.guest'); location.reload(); } else err('Account created! Check your email to confirm it, then log in.');
  };
  $('#li').onclick = () => go('li'); $('#su').onclick = () => go('su');
  $('#pw').onkeydown = e => { if (e.key === 'Enter') go('li'); };
}
async function boot() {
  let cfg = {}; try { cfg = await (await fetch('/api/config')).json(); } catch {}
  useCF = !!cfg.cf;
  if (cfg.supabaseUrl) {
    const wantGuest = sessionStorage.getItem('nova.guest') === '1';
    let session = null;
    if (window.supabase) {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey);
      session = (await sb.auth.getSession()).data.session;
    }
    if (session) {
      sessionStorage.removeItem('nova.guest');
      $('#user').hidden = false; $('#userEmail').textContent = session.user.email;
      $('#logout').onclick = () => sb.auth.signOut().then(() => { localStorage.removeItem('nova.cur'); location.reload(); });
      const { data: rows, error } = await sb.from('chats').select('id,title,messages,updated').order('updated', { ascending: false });
      if (error) alert('Could not load your chats: ' + error.message);
      chats = rows || [];
    } else if (wantGuest) {
      sb = null; guest = true;
      $('#user').hidden = false; $('#userEmail').textContent = 'Guest · chats are not saved';
      $('#logout').textContent = 'Log in';
      $('#toolbtn').style.opacity = '.5'; $('#toolbtn').title = 'Log in to use the tools';
      $('#logout').onclick = () => { sessionStorage.removeItem('nova.guest'); location.reload(); };
    } else return showAuth(window.supabase ? '' : 'Could not load the login library. Check your internet connection, or continue as a guest.', !window.supabase);
  } else { try { chats = JSON.parse(localStorage.getItem('nova.chats') || '[]'); } catch {} }
  cur = guest ? null : localStorage.getItem('nova.cur'); if (!chats.some(c => c.id === cur)) cur = null;
  setBusy(false); renderList(); renderChat();
}
boot();
