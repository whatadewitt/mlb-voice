(function () {
  // Mock game-level constants — things that don't (yet) come from the live
  // pipeline. Match the shape used in the design reference (app.jsx GAME).
  const GAME = {
    announcers: 'Pat Twinkle & Marty Doefinger',
  };

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

  // ── Static mock fields ────────────────────────────────────────
  const nowPlayingNameEl = document.querySelector('.now-playing span:not(.nb-label)');
  if (nowPlayingNameEl) nowPlayingNameEl.textContent = GAME.announcers;

  // ── HLS attach ────────────────────────────────────────────────
  // Retry config is generous on purpose: the page often loads BEFORE the
  // demo runner has called /start_hls, so the very first manifest fetch
  // hits a 404. Default hls.js retries once and gives up — silent demo.
  // With these settings it'll patiently poll until the playlist appears.
  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({
      enableWorker: true,
      manifestLoadingMaxRetry: 20,
      manifestLoadingRetryDelay: 1000,
      manifestLoadingMaxRetryTimeout: 30000,
      levelLoadingMaxRetry: 20,
      levelLoadingRetryDelay: 1000,
      levelLoadingMaxRetryTimeout: 30000,
    });
    hls.loadSource(HLS_URL);
    hls.attachMedia(audio);
    hls.on(window.Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      console.warn('HLS fatal error, attempting recovery', data);
      // For manifest/network fatals, re-trigger loadSource so we don't
      // permanently give up if the server was slow to start.
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
        setTimeout(() => {
          try { hls.loadSource(HLS_URL); hls.startLoad(); } catch (e) {}
        }, 1500);
      } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); } catch (e) {}
      }
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

  const inningNumEl = document.querySelector('.inning-num');
  const scoreBlockEl = document.querySelector('.score-block');
  const atBatLineEl = document.querySelector('.at-bat .line');
  // The inning-strip-left holds: [.inning-num, .dot-sep, venue-span, .dot-sep, game-num-span]
  // Grab the venue span (first span that isn't .inning-num or .dot-sep).
  const venueEl = (() => {
    const left = document.querySelector('.inning-strip-left');
    if (!left) return null;
    return left.querySelector('span:not(.inning-num):not(.dot-sep)');
  })();

  function ordinal(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'th';
    const s = ['th', 'st', 'nd', 'rd'];
    return n + (s[n % 10] || 'th');
  }

  function applyTeam(side, team) {
    if (!team) return;
    const teamEl = document.querySelector(`.team.${side}`);
    if (!teamEl) return;
    const logo = teamEl.querySelector('.team-logo');
    if (logo && team.id) {
      // MLB spot logo — transparent PNG, sized to fit inside the existing 88px badge ring.
      const url = `https://midfield.mlbstatic.com/v1/team/${team.id}/spots/108`;
      if (logo.dataset.teamId !== String(team.id)) {
        logo.innerHTML = `<img src="${url}" alt="${team.abbreviation || ''}" style="width:80px;height:80px;object-fit:contain"/>`;
        logo.dataset.teamId = String(team.id);
      }
    }
    const city = teamEl.querySelector('.team-city');
    if (city && team.location) city.textContent = team.location;
    const name = teamEl.querySelector('.team-name');
    if (name && team.short_name) name.textContent = team.short_name;
    const record = teamEl.querySelector('.team-record');
    if (record && team.record && team.record.wins != null && team.record.losses != null) {
      record.textContent = `${team.record.wins}-${team.record.losses}`;
    }
  }

  function applyScore(score) {
    if (!score || !scoreBlockEl) return;
    const spans = scoreBlockEl.querySelectorAll('span:not(.dash)');
    if (spans.length >= 2) {
      spans[0].textContent = score.away ?? 0;
      spans[1].textContent = score.home ?? 0;
    }
    scoreBlockEl.setAttribute('aria-label', `Score ${score.away ?? 0} to ${score.home ?? 0}`);
  }

  function applyInning(inning, half) {
    if (!inningNumEl || inning == null || !half) return;
    const label = half === 'top' ? 'Top' : 'Bot';
    inningNumEl.textContent = `${label} ${ordinal(inning)}`;
  }

  function applyVenue(venue) {
    if (!venueEl || !venue) return;
    venueEl.textContent = venue;
  }

  const demoCompleteEl = document.querySelector('[data-sse-demo-complete]');
  function showDemoComplete() {
    if (!demoCompleteEl) return;
    demoCompleteEl.hidden = false;
    // Defer the data-visible flip so the CSS transition runs.
    requestAnimationFrame(() => demoCompleteEl.setAttribute('data-visible', 'true'));
  }

  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    if (s._demo_complete) showDemoComplete();
    if ('balls' in s) setPips('balls', s.balls);
    if ('strikes' in s) setPips('strikes', s.strikes);
    if ('outs' in s) setPips('outs', s.outs);
    if ('runners' in s) setRunners(s.runners);
    if (atBatPlayer && s.batter) atBatPlayer.textContent = s.batter;
    if (atBatLineEl) {
      const parts = [];
      if (s.batter_line) parts.push(s.batter_line);
      if (s.pitcher) {
        const pitchSuffix = s.pitcher_pitches != null ? ` (${s.pitcher_pitches} P)` : '';
        parts.push(`vs. ${s.pitcher}${pitchSuffix}`);
      }
      if (parts.length) atBatLineEl.textContent = parts.join(' · ');
    }
    if (s.teams) {
      applyTeam('home', s.teams.home);
      applyTeam('away', s.teams.away);
    }
    if (s.score) applyScore(s.score);
    if (s.inning != null && s.half) applyInning(s.inning, s.half);
    if (s.venue) applyVenue(s.venue);
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
