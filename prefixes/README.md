# Voice Prefixes

> Only used by `TTS_BACKEND=dia2`. The default `elevenlabs` backend
> resolves voices by name via the ElevenLabs API and ignores this dir.

Dia2 conditions on prefix audio for stable speakers. We need 4 files:

- `broadcaster_s1.wav` — play-by-play voice (excitable)
- `broadcaster_s2.wav` — color voice (gravelly, lower-key)
- `ad_s1.wav` — old-timey announcer
- `ad_s2.wav` — testimonial / foil (optional, used only by some ad templates)

Each file should be 5–15 seconds of clean speech, 24kHz+ WAV.

## Sourcing rules (legal)

Dia2's license forbids cloning real people without consent. Acceptable sources:

1. Licensed voice library with explicit AI-cloning consent (Murf, PlayHT, similar paid services).
2. Friend / colleague recordings with explicit consent. Document in dev-log.
3. Royalty-free AI-voice stock with cloning rights.

**Do not** clone Joe Buck, Vin Scully, or any real broadcaster.
