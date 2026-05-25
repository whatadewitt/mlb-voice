/* global React, ReactDOM, Hls */
const { useState, useEffect, useRef, useCallback } = React;

// ── Mock game data ──────────────────────────────────────────
const GAME = {
  away: { city: 'Brooklyn',   name: 'Hawks',    abbr: 'BKH', record: '74-58', score: 5, color: '#6B2733', logoLetters: 'BH' },
  home: { city: 'Portland',   name: 'Knights',  abbr: 'PTK', record: '79-53', score: 3, color: '#18324E', logoLetters: 'PK' },
  inning: 'Top 7th',
  outs: 1,
  balls: 2,
  strikes: 1,
  bases: { first: true, second: false, third: true },
  atBat: { name: 'M. Rodríguez', line: '2-for-4, HR' },
  pitching: 'D. Tanaka (87 P)',
  announcers: 'Pat Twinkle & Marty Doefinger',
  field: 'Veritas Field',
  listeners: '12,847',
};

const PBP = [
  { inning: 'T7 · 1 out', tag: 'HIT',  tagClass: 'hit', text: '<strong>M. Rodríguez</strong> singles sharply to left. <strong>Chen</strong> advances to third.' },
  { inning: 'T7 · 1 out', tag: 'OUT',  tagClass: 'out', text: 'A. Park strikes out swinging — 94 mph fastball, painted the outside corner.' },
  { inning: 'T7 · 0 out', tag: 'RUN',  tagClass: 'run', text: '<strong>L. Chen</strong> doubles to the gap. <strong>Walker</strong> scores from second. 5–3, Hawks.' },
  { inning: 'B6 · 3 out', tag: 'OUT',  tagClass: 'out', text: 'Side retired. End of the sixth.' },
  { inning: 'B6 · 2 out', tag: 'HIT',  tagClass: 'hit', text: 'J. Walker laces a single up the middle. Runner held at second.' },
  { inning: 'B6 · 1 out', tag: 'OUT',  tagClass: 'out', text: 'Foul out to the catcher, near the on-deck circle.' },
  { inning: 'T6 · 3 out', tag: 'RUN',  tagClass: 'run', text: '<strong>R. Okafor</strong> homers to deep right-center. Solo shot, 412 ft. 4–3, Hawks.' },
];

// ── Icons ───────────────────────────────────────────────────
const IconPlay  = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>);
const IconPause = () => (<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>);
const IconVol = ({ muted }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5L6 9H3v6h3l5 4V5z"/>
    {muted ? (
      <><path d="M22 9l-6 6"/><path d="M16 9l6 6"/></>
    ) : (
      <><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></>
    )}
  </svg>
);

// ── Visualizer (decorative, animates while playing) ─────────
function Visualizer({ active, accent }) {
  const ref = useRef(null);
  const rafRef = useRef(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const BARS = 56;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      const gap = 4;
      const barW = Math.max(2, (width - gap * (BARS - 1)) / BARS);
      phaseRef.current += active ? 0.085 : 0;

      for (let i = 0; i < BARS; i++) {
        // smooth pseudo-random amplitude
        const t = phaseRef.current;
        const n =
          Math.sin(i * 0.42 + t) * 0.4 +
          Math.sin(i * 0.13 - t * 1.3) * 0.3 +
          Math.sin(i * 0.83 + t * 0.6) * 0.3;
        const idle = 0.12;
        const amp = active ? (0.35 + n * 0.5) : idle;
        const h = Math.max(2, Math.abs(amp) * height);
        const x = i * (barW + gap);
        const y = (height - h) / 2;
        ctx.fillStyle = accent;
        ctx.globalAlpha = active ? (0.55 + Math.abs(amp) * 0.5) : 0.35;
        ctx.fillRect(x, y, barW, h);
      }
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [active, accent]);

  return <canvas ref={ref} className="viz" />;
}

// ── Team crest (placeholder roundel) ────────────────────────
function TeamLogo({ side, letters, primary, secondary }) {
  // Style classes already define visual default; allow per-tweak overrides via inline.
  return (
    <div
      className={`team-logo ${side}`}
      style={primary ? { background: primary, borderColor: secondary, color: secondary } : undefined}
      aria-hidden="true"
    >
      {letters}
    </div>
  );
}

// ── Diamond ─────────────────────────────────────────────────
function Diamond({ bases }) {
  return (
    <div className="diamond">
      <div className={`base second ${bases.second ? 'occupied' : ''}`} />
      <div className={`base third ${bases.third ? 'occupied' : ''}`} />
      <div className={`base first ${bases.first ? 'occupied' : ''}`} />
      <div className="base home" />
    </div>
  );
}

// ── Count / pips ────────────────────────────────────────────
function CountDisplay({ balls, strikes, outs }) {
  const pip = (filled, cls) =>
    <span className={`pip ${filled ? `filled ${cls}` : ''}`} />;
  return (
    <div className="count">
      <div className="count-item">
        <span className="count-label">B</span>
        <span className="count-pips">{[0,1,2].map(i => <React.Fragment key={i}>{pip(i < balls, 'balls')}</React.Fragment>)}</span>
      </div>
      <div className="count-item">
        <span className="count-label">S</span>
        <span className="count-pips">{[0,1].map(i => <React.Fragment key={i}>{pip(i < strikes, 'strikes')}</React.Fragment>)}</span>
      </div>
      <div className="count-item">
        <span className="count-label">O</span>
        <span className="count-pips">{[0,1].map(i => <React.Fragment key={i}>{pip(i < outs, 'outs')}</React.Fragment>)}</span>
      </div>
    </div>
  );
}

// ── HLS hook ────────────────────────────────────────────────
function useHls(audioRef, url) {
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    let hls;

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ enableWorker: true });
      hls.loadSource(url);
      hls.attachMedia(audio);
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (data.fatal) console.warn('HLS fatal error', data);
      });
    } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
      audio.src = url;
    }

    return () => { if (hls) hls.destroy(); };
  }, [url, audioRef]);
}

// ── App ─────────────────────────────────────────────────────
function App() {
  const defaults = window.__TWEAK_DEFAULTS;
  const [t, setTweak] = useTweaks(defaults);

  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);

  useHls(audioRef, t.hlsUrl);

  // Sync volume / mute to audio element
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  // Apply accent token
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', t.accent);
  }, [t.accent]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().then(() => setPlaying(true)).catch(err => {
        console.warn('Playback failed:', err);
        // still toggle the UI so the design demos work without a real stream
        setPlaying(true);
      });
    } else {
      a.pause();
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
    };
  }, []);

  return (
    <div className="app" data-style={t.style}>
      <div className="bg" />
      <div className="neon-sun" />

      {/* Top bar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span className="ai">AI</span></div>
          <div className="brand-name">MLB r<span className="ai-mono">AI</span>dio<span className="tagline">· The game, on air</span></div>
        </div>
        <div className="topbar-right">
          <span className="live-pill">
            <span className="live-dot" />
            On Air
          </span>
          <span>{GAME.listeners} listening</span>
        </div>
      </header>

      {/* Stage */}
      <main className="stage">
        <section className="broadcast-card" aria-label="Broadcast">
          <div className="inning-strip">
            <div className="inning-strip-left">
              <span className="inning-num">{GAME.inning}</span>
              <span className="dot-sep" />
              <span>{GAME.field}</span>
              <span className="dot-sep" />
              <span>Game 132</span>
            </div>
            <div>Sat · Aug 12 · 7:08 PM ET</div>
          </div>

          {/* Scoreboard */}
          <div className="scoreboard">
            <div className="team away">
              <TeamLogo side="away" letters={GAME.away.logoLetters} />
              <div className="team-meta">
                <span className="team-city">{GAME.away.city}</span>
                <span className="team-name">{GAME.away.name}</span>
                <span className="team-record">{GAME.away.record} · away</span>
              </div>
            </div>

            <div className="score-block" aria-label={`Score ${GAME.away.score} to ${GAME.home.score}`}>
              <span>{GAME.away.score}</span>
              <span className="dash">—</span>
              <span>{GAME.home.score}</span>
            </div>

            <div className="team home">
              <TeamLogo side="home" letters={GAME.home.logoLetters} />
              <div className="team-meta">
                <span className="team-city">{GAME.home.city}</span>
                <span className="team-name">{GAME.home.name}</span>
                <span className="team-record">{GAME.home.record} · home</span>
              </div>
            </div>
          </div>

          {/* Game state */}
          <div className="game-state" style={"display: none;"}>
            <Diamond bases={GAME.bases} />
            <CountDisplay balls={GAME.balls} strikes={GAME.strikes} outs={GAME.outs} />
            <div className="at-bat">
              <span className="label">At bat</span>
              <span className="player">{GAME.atBat.name}</span>
              <span className="line">{GAME.atBat.line} · vs. {GAME.pitching}</span>
            </div>
          </div>

          {/* Player */}
          <div className="player">
            <button
              className="play-btn"
              onClick={togglePlay}
              aria-label={playing ? 'Pause broadcast' : 'Play broadcast'}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>

            <div className="visualizer-wrap">
              <div className="now-playing">
                <span className="nb-label">On the call</span>
                <span>{GAME.announcers} · {GAME.away.abbr} @ {GAME.home.abbr}</span>
              </div>
              {t.showVisualizer ? (
                <Visualizer active={playing} accent={t.accent} />
              ) : (
                <div className="viz-static">
                  <span className="bar" /><span className="bar" /><span className="bar" />
                  <span>Audio · 128 kbps AAC</span>
                </div>
              )}
            </div>

            <div className="volume-control">
              <button className="vol-icon" onClick={() => setMuted(m => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>
                <IconVol muted={muted || volume === 0} />
              </button>
              <input
                className="vol-slider"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={muted ? 0 : volume}
                onChange={(e) => { setMuted(false); setVolume(parseFloat(e.target.value)); }}
                aria-label="Volume"
              />
            </div>

            <audio ref={audioRef} preload="none" crossOrigin="anonymous" />
          </div>
        </section>

        {/* Play-by-play */}
        {t.showPlayByPlay && (
          <section className="pbp-card" aria-label="Play-by-play">
            <div className="pbp-header">
              <span>Play-by-play</span>
              <span>Auto-updating · 5s delay</span>
            </div>
            <ul className="pbp-list">
              {PBP.map((p, i) => (
                <li className="pbp-item" key={i}>
                  <span className="pbp-inning">{p.inning}</span>
                  <span className="pbp-text" dangerouslySetInnerHTML={{ __html: p.text }} />
                  <span className={`pbp-tag ${p.tagClass}`}>{p.tag}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="footer">
        <span>© MLB rAIdio · REDspace affiliate broadcasting network</span>
        <span>Stream · HLS · 128 kbps</span>
      </footer>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Style">
          <TweakRadio
            label="Vibe"
            value={t.style}
            options={[
              { value: 'pro',  label: 'Pro' },
              { value: 'neon', label: 'Neon' },
            ]}
            onChange={(v) => setTweak('style', v)}
          />
          <TweakColor
            label="Accent"
            value={t.accent}
            options={['#E2253D', '#F4B400', '#0E7C66', '#3D5AFE', '#FF2891']}
            onChange={(v) => setTweak('accent', v)}
          />
        </TweakSection>

        <TweakSection label="Content">
          <TweakToggle
            label="Visualizer"
            value={t.showVisualizer}
            onChange={(v) => setTweak('showVisualizer', v)}
          />
          <TweakToggle
            label="Play-by-play feed"
            value={t.showPlayByPlay}
            onChange={(v) => setTweak('showPlayByPlay', v)}
          />
        </TweakSection>

        <TweakSection label="Stream">
          <TweakText
            label="HLS URL"
            value={t.hlsUrl}
            placeholder="https://…/stream.m3u8"
            onChange={(v) => setTweak('hlsUrl', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
