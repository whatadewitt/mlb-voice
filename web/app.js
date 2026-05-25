(function () {
  const audio = document.getElementById('audio');
  const playBtn = document.getElementById('play-btn');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  const volSlider = document.getElementById('vol-slider');
  const volIconBtn = document.getElementById('vol-icon');
  const iconVolOn = document.getElementById('icon-vol-on');
  const iconVolOff = document.getElementById('icon-vol-off');
  const canvas = document.getElementById('viz');

  const HLS_URL = '/hls/playlist.m3u8';
  let playing = false;
  let muted = false;
  let lastVolume = 0.7;

  // ── HLS attach ────────────────────────────────────────────────
  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ enableWorker: true });
    hls.loadSource(HLS_URL);
    hls.attachMedia(audio);
    hls.on(window.Hls.Events.ERROR, (_, data) => {
      if (data.fatal) console.warn('HLS fatal error', data);
    });
  } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
    audio.src = HLS_URL;
  }

  // ── Play / pause ──────────────────────────────────────────────
  function setPlayingUI(state) {
    playing = state;
    iconPlay.style.display = state ? 'none' : '';
    iconPause.style.display = state ? '' : 'none';
    playBtn.setAttribute('aria-label', state ? 'Pause broadcast' : 'Play broadcast');
  }

  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play().then(() => setPlayingUI(true)).catch((err) => {
        console.warn('Playback failed:', err);
        setPlayingUI(true);
      });
    } else {
      audio.pause();
      setPlayingUI(false);
    }
  });

  audio.addEventListener('play', () => setPlayingUI(true));
  audio.addEventListener('pause', () => setPlayingUI(false));

  // ── Volume / mute ─────────────────────────────────────────────
  function applyVolume() {
    audio.volume = muted ? 0 : lastVolume;
    volSlider.value = muted ? 0 : lastVolume;
    const showMuted = muted || lastVolume === 0;
    iconVolOn.style.display = showMuted ? 'none' : '';
    iconVolOff.style.display = showMuted ? '' : 'none';
    volIconBtn.setAttribute('aria-label', showMuted ? 'Unmute' : 'Mute');
  }

  volSlider.addEventListener('input', (e) => {
    lastVolume = parseFloat(e.target.value);
    muted = false;
    applyVolume();
  });

  volIconBtn.addEventListener('click', () => {
    muted = !muted;
    applyVolume();
  });

  applyVolume();

  // ── Live state via SSE ────────────────────────────────────────
  // Server pushes a snapshot every time the pipeline observes a new play.
  // Snapshot shape: { balls, strikes, outs, runners, batter, pitcher, ... }
  const pipRoots = {
    balls: document.querySelector('[data-sse-balls]'),
    strikes: document.querySelector('[data-sse-strikes]'),
    outs: document.querySelector('[data-sse-outs]'),
  };
  const diamond = document.querySelector('[data-sse-runners]');
  const atBatPlayer = document.querySelector('.at-bat .player');

  function setPips(kind, count) {
    const root = pipRoots[kind];
    if (!root) return;
    const total = root.children.length;
    const filled = Math.max(0, Math.min(total, count | 0));
    for (let i = 0; i < total; i++) {
      root.children[i].className = i < filled ? `pip filled ${kind}` : 'pip';
    }
    root.setAttribute(`data-sse-${kind}`, String(filled));
  }

  function setRunners(runners) {
    if (!diamond) return;
    const occupied = new Set((runners || []).map((n) => Number(n)));
    const byBase = { 1: 'first', 2: 'second', 3: 'third' };
    for (const [n, name] of Object.entries(byBase)) {
      const base = diamond.querySelector(`.base.${name}`);
      if (!base) continue;
      base.classList.toggle('occupied', occupied.has(Number(n)));
    }
    diamond.setAttribute('data-sse-runners', [...occupied].sort().join(','));
  }

  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    if ('balls' in s) setPips('balls', s.balls);
    if ('strikes' in s) setPips('strikes', s.strikes);
    if ('outs' in s) setPips('outs', s.outs);
    if ('runners' in s) setRunners(s.runners);
    if (atBatPlayer && s.batter) atBatPlayer.textContent = s.batter;
  }

  if (typeof EventSource !== 'undefined') {
    const es = new EventSource('/events');
    es.onmessage = (ev) => {
      try { applyState(JSON.parse(ev.data)); }
      catch (e) { console.warn('SSE parse failed', e, ev.data); }
    };
    es.onerror = () => {
      // EventSource auto-reconnects on transient errors; only log so we don't
      // tear the connection down.
      console.debug('SSE transient error; browser will reconnect');
    };
  }

  // ── Visualizer (decorative) ───────────────────────────────────
  const ctx = canvas.getContext('2d');
  const BARS = 56;
  let phase = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  function accent() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#E2253D';
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);
    const gap = 4;
    const barW = Math.max(2, (width - gap * (BARS - 1)) / BARS);
    phase += playing ? 0.085 : 0;

    const fill = accent();
    for (let i = 0; i < BARS; i++) {
      const n =
        Math.sin(i * 0.42 + phase) * 0.4 +
        Math.sin(i * 0.13 - phase * 1.3) * 0.3 +
        Math.sin(i * 0.83 + phase * 0.6) * 0.3;
      const amp = playing ? (0.35 + n * 0.5) : 0.12;
      const h = Math.max(2, Math.abs(amp) * height);
      const x = i * (barW + gap);
      const y = (height - h) / 2;
      ctx.fillStyle = fill;
      ctx.globalAlpha = playing ? (0.55 + Math.abs(amp) * 0.5) : 0.35;
      ctx.fillRect(x, y, barW, h);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
})();
