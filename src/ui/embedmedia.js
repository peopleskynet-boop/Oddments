// YouTube and Vimeo played under Oddments' own controls. The site's player sits in an iframe with its own controls
// hidden where the site allows it; this object speaks to it through the site's postMessage API (the same messages
// their JS libraries send — those libraries cannot be loaded: script-src is 'self') and looks to player.js like a
// <video>: paused, currentTime, duration, volume, muted, playbackRate, play(), pause() and the usual events.
// Not possible across origins: reading pixels, so no frame grabbing for these clips.
const YT_ORIGIN = 'https://www.youtube-nocookie.com', VIMEO_ORIGIN = 'https://player.vimeo.com';

export function embedSrc(site, id) {
  if (site === 'YouTube') {
    const o = encodeURIComponent(location.origin);
    return `${YT_ORIGIN}/embed/${encodeURIComponent(id)}?enablejsapi=1&controls=0&autoplay=1&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3&cc_load_policy=0&disablekb=1&fs=0&origin=${o}&widget_referrer=${o}`;
  }
  // controls=0 hides Vimeo's bar only for videos whose owner has a paid plan; elsewhere theirs stays under ours
  return `${VIMEO_ORIGIN}/video/${encodeURIComponent(id)}?autoplay=1&dnt=1&title=0&byline=0&portrait=0&controls=0&playsinline=1&keyboard=0`;
}

export function embedMedia(site, iframe) {
  const target = new EventTarget();
  const st = { paused: true, t: 0, d: 0, vol: 1, muted: false, rate: 1, loop: false, loaded: 0, ready: false, gotMeta: false,
    // what the site offers (bug #68): qualities [{ id, label, active }] and subtitle tracks [{ id, label, active }]
    qualities: [], tracks: [] };
  const fire = (type) => target.dispatchEvent(new Event(type));
  const queue = [];
  const post = (msg) => {
    if (!st.ready) { queue.push(msg); return; }
    try { iframe.contentWindow.postMessage(JSON.stringify(msg), site === 'YouTube' ? YT_ORIGIN : VIMEO_ORIGIN); } catch (e) { /* gone */ }
  };
  const flush = () => { st.ready = true; queue.splice(0).forEach(post); };
  const meta = () => { if (!st.gotMeta && st.d > 0) { st.gotMeta = true; fire('loadedmetadata'); } };

  /* ---------- YouTube ---------- */
  const yt = (func, ...args) => post({ event: 'command', func, args, id: 1, channel: 'widget' });
  // the player answers only after it has been told someone listens; until it does, ask again
  let hello = 0;
  const listen = () => {
    try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN); } catch (e) { /* not loaded */ }
  };
  function onYouTube(m) {
    if (m.event === 'onReady' || m.event === 'initialDelivery') { clearInterval(hello); flush(); if (m.event === 'onReady') yt('unloadModule', 'captions'); }
    const i = m.info;
    if (!i || typeof i !== 'object') return;
    if (typeof i.duration === 'number' && i.duration) { st.d = i.duration; meta(); }
    if (typeof i.currentTime === 'number') { st.t = i.currentTime; fire('timeupdate'); }
    if (typeof i.videoLoadedFraction === 'number') { st.loaded = i.videoLoadedFraction; fire('progress'); }
    if (typeof i.volume === 'number' || typeof i.muted === 'boolean') {
      if (typeof i.volume === 'number') st.vol = i.volume / 100;
      if (typeof i.muted === 'boolean') st.muted = i.muted;
      fire('volumechange');
    }
    if (typeof i.playbackRate === 'number' && i.playbackRate !== st.rate) { st.rate = i.playbackRate; fire('ratechange'); }
    // YouTube stopped honouring quality requests from embeds in 2019; a list is shown only when the player gives one
    if (Array.isArray(i.availableQualityLevels) && i.availableQualityLevels.length > 1) {
      const cur = i.playbackQuality || '';
      const names = { hd2160: '2160p', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p', auto: 'Авто' };
      const q = i.availableQualityLevels.map((l) => ({ id: l, label: names[l] || l, active: l === cur }));
      if (JSON.stringify(q) !== JSON.stringify(st.qualities)) { st.qualities = q; fire('qualitieschange'); }
    }
    if (typeof i.playerState === 'number') {
      const was = st.paused;
      if (i.playerState === 1) st.paused = false;
      else if (i.playerState === 2 || i.playerState === 5 || i.playerState === -1) st.paused = true;
      else if (i.playerState === 0) {
        if (st.loop) { yt('seekTo', 0, true); yt('playVideo'); } else st.paused = true;
      }
      if (was !== st.paused) fire(st.paused ? 'pause' : 'play');
    }
  }

  /* ---------- Vimeo ---------- */
  const vm = (method, value) => post(value === undefined ? { method } : { method, value });
  function onVimeo(m) {
    if (m.event === 'ready') {
      flush();
      ['timeupdate', 'play', 'pause', 'ended', 'progress', 'volumechange', 'playbackratechange', 'loaded', 'seeked'].forEach((e) => vm('addEventListener', e));
      ['getDuration', 'getVolume', 'getMuted', 'getPaused', 'getPlaybackRate', 'getQualities', 'getTextTracks'].forEach((g) => vm(g));
      vm('addEventListener', 'qualitychange'); vm('addEventListener', 'texttrackchange');
      return;
    }
    const d = m.data || {};
    if (m.event === 'timeupdate') { st.t = d.seconds ?? st.t; if (d.duration) { st.d = d.duration; meta(); } fire('timeupdate'); }
    else if (m.event === 'progress') { st.loaded = d.percent ?? st.loaded; fire('progress'); }
    else if (m.event === 'play' || m.event === 'playing') { if (st.paused) { st.paused = false; fire('play'); } }
    else if (m.event === 'pause') { if (!st.paused) { st.paused = true; fire('pause'); } }
    else if (m.event === 'ended') { if (st.loop) { vm('setCurrentTime', 0); vm('play'); } else { st.paused = true; fire('pause'); } }
    else if (m.event === 'volumechange') { if (typeof d.volume === 'number') st.vol = d.volume; fire('volumechange'); }
    else if (m.event === 'playbackratechange') { if (typeof d.playbackRate === 'number') st.rate = d.playbackRate; fire('ratechange'); }
    else if (m.event === 'seeked') { st.t = d.seconds ?? st.t; fire('seeked'); }
    else if (m.method === 'getDuration') { st.d = m.value || st.d; meta(); }
    else if (m.method === 'getVolume') { st.vol = m.value; fire('volumechange'); }
    else if (m.method === 'getMuted') { st.muted = !!m.value; fire('volumechange'); }
    else if (m.method === 'getPaused') { st.paused = !!m.value; fire(st.paused ? 'pause' : 'play'); }
    else if (m.method === 'getPlaybackRate') { st.rate = m.value || 1; fire('ratechange'); }
    // qualities: allowed by the video's owner — otherwise Vimeo answers with an error or one «auto»
    else if (m.method === 'getQualities' && Array.isArray(m.value)) { st.qualities = m.value.map((q) => ({ id: q.id, label: q.label === 'Auto' ? 'Авто' : q.label, active: !!q.active })); fire('qualitieschange'); }
    else if (m.event === 'qualitychange') { st.qualities = st.qualities.map((q) => ({ ...q, active: q.id === d.quality })); fire('qualitieschange'); }
    else if (m.method === 'getTextTracks' && Array.isArray(m.value)) { st.tracks = m.value.map((t) => ({ id: t.language, label: t.label || t.language, active: t.mode === 'showing' })); fire('trackschange'); }
    else if (m.event === 'texttrackchange') { st.tracks = st.tracks.map((t) => ({ ...t, active: !!d.language && t.id === d.language })); fire('trackschange'); }
  }

  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow) return;
    let m = e.data;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (er) { return; } }
    if (!m || typeof m !== 'object') return;
    if (site === 'YouTube') onYouTube(m); else onVimeo(m);
  };
  window.addEventListener('message', onMessage);
  if (site === 'YouTube') iframe.addEventListener('load', () => { listen(); hello = setInterval(listen, 250); setTimeout(() => clearInterval(hello), 10000); });
  // a clip that never answers (blocked, removed, private): say so like a <video> would
  const dead = setTimeout(() => { if (!st.ready) fire('error'); }, 15000);

  const media = {
    // the <video> surface player.js uses
    get paused() { return st.paused; },
    get currentTime() { return st.t; },
    set currentTime(t) {
      st.t = Math.max(0, Math.min(st.d || t, t));
      if (site === 'YouTube') yt('seekTo', st.t, true); else vm('setCurrentTime', st.t);
      fire('timeupdate'); fire('seeked');
    },
    get duration() { return st.d || NaN; },
    get volume() { return st.vol; },
    set volume(v) { st.vol = v; if (site === 'YouTube') yt('setVolume', Math.round(v * 100)); else vm('setVolume', v); fire('volumechange'); },
    get muted() { return st.muted; },
    set muted(m) { st.muted = m; if (site === 'YouTube') yt(m ? 'mute' : 'unMute'); else vm('setMuted', m); fire('volumechange'); },
    get playbackRate() { return st.rate; },
    // Vimeo changes speed only when the owner allowed it; the button then stays at what the player reports
    set playbackRate(r) { if (site === 'YouTube') yt('setPlaybackRate', r); else vm('setPlaybackRate', r); st.rate = r; fire('ratechange'); },
    get loop() { return st.loop; },
    set loop(l) { st.loop = l; if (site === 'Vimeo') vm('setLoop', l); },
    get buffered() { return st.loaded && st.d ? { length: 1, end: () => st.loaded * st.d } : { length: 0, end: () => 0 }; },
    play() { st.paused = false; if (site === 'YouTube') yt('playVideo'); else vm('play'); fire('play'); return Promise.resolve(); },
    pause() { st.paused = true; if (site === 'YouTube') yt('pauseVideo'); else vm('pause'); fire('pause'); },
    addEventListener: (type, fn, opts) => target.addEventListener(type, fn, opts),
    removeEventListener: (type, fn) => target.removeEventListener(type, fn),
    dispatchEvent: (e) => target.dispatchEvent(e),
    embedded: site,
    get qualities() { return st.qualities; },
    setQuality(id) { if (site === 'Vimeo') vm('setQuality', id); else yt('setPlaybackQuality', id); st.qualities = st.qualities.map((q) => ({ ...q, active: q.id === id })); fire('qualitieschange'); },
    // YouTube does not list its tracks over postMessage: one switch — the captions module on or off
    get tracks() { return site === 'YouTube' ? [{ id: 'on', label: 'Включить', active: st.cc }] : st.tracks; },
    setTrack(id) {
      if (site === 'YouTube') { st.cc = !!id; if (id) { yt('loadModule', 'captions'); yt('setOption', 'captions', 'track', { languageCode: 'ru' }); } else { yt('setOption', 'captions', 'track', {}); yt('unloadModule', 'captions'); } }
      else if (id) vm('enableTextTrack', id); else vm('disableTextTrack');
      if (site !== 'YouTube') st.tracks = st.tracks.map((t) => ({ ...t, active: t.id === id }));
      fire('trackschange');
    },
    destroy() { window.removeEventListener('message', onMessage); clearInterval(hello); clearTimeout(dead); },
  };
  target.addEventListener('timeupdate', () => clearTimeout(dead), { once: true });
  return media;
}
