// Oddments for browsers: inside an embedded Vimeo player (Behance shows its animations this way). The page
// around never hears the pointer once it is over the player, so this frame has its own «В Oddments» button on hover
// and its own Alt+click; the service worker reads this frame's player config and glues the stream into an .mp4.
(() => {
  if (window.__perchEmbed) return;
  window.__perchEmbed = true;
  let prefs = { altClick: true, hoverBtn: true };
  const load = () => chrome.storage.local.get(['altClick', 'hoverBtn']).then((p) => { prefs = { ...prefs, ...p }; }).catch(() => {});
  load();
  chrome.storage.onChanged.addListener(load);
  const save = () => chrome.runtime.sendMessage({ t: 'saveEmbed' }).catch(() => {});

  let swallow = 0;
  const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  addEventListener('pointerdown', (e) => {
    if (!e.altKey || e.button !== 0 || !prefs.altClick) return;
    eat(e);
    swallow = Date.now();
    save();
  }, true);
  for (const type of ['mousedown', 'pointerup', 'mouseup', 'click']) {
    addEventListener(type, (e) => { if (swallow && Date.now() - swallow < 1500) { eat(e); if (type === 'click') swallow = 0; } }, true);
  }

  // the hover button, in a closed shadow root like on pages
  const host = document.createElement('perch-ui');
  host.style.cssText = 'all: initial; position: fixed; left: 10px; top: 10px; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    button { display: none; align-items: center; gap: 7px; padding: 6px 12px 6px 9px; border: 0; border-radius: 999px; cursor: pointer;
      background: rgba(16, 19, 30, .88); color: #eceaf2; font: 12px "Golos Text", "Segoe UI", system-ui, sans-serif;
      box-shadow: 0 4px 18px rgba(0,0,0,.3), inset 0 0 0 1px rgba(255,255,255,.1); }
    button.on { display: flex; }
    button:hover { background: #d7ff63; color: #0b0c10; }
    svg { width: 16px; height: 16px; flex: none; }
  </style><button type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="odd-prism" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6b4ff"/><stop offset=".5" stop-color="#a7c7ff"/><stop offset="1" stop-color="#ffc7e8"/></linearGradient></defs><path d="M12 4.4 20 18.4H4Z" fill="none" stroke="url(#odd-prism)" stroke-width="3.4" stroke-linejoin="round"/></svg>${T('В Oddments')}</button>`;
  const btn = root.querySelector('button');
  const mount = () => { if (!host.isConnected && document.body) document.body.appendChild(host); };
  let hideT = null;
  addEventListener('mousemove', () => {
    if (!prefs.hoverBtn || innerWidth < 160 || innerHeight < 110) return;
    mount();
    btn.classList.add('on');
    clearTimeout(hideT);
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { hideT = setTimeout(() => btn.classList.remove('on'), 260); });
  btn.addEventListener('click', (e) => { eat(e); btn.classList.remove('on'); save(); });
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
})();
