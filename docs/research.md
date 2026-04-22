# distill — Tech Research

> 2026-04-21 · Research notes for Wave 1 implementation decisions. Author: CC subagent (Explore).

## 1. Jina Reader API

- **Install**: HTTP API endpoint (no installation required for client)
- **Endpoint**: `https://r.jina.ai/<url>` (prepend to any URL)
- **Auth & rate limits**:
  - Free tier: 20 requests/minute (RPM) without API key (anonymous access works)
  - Free tier with API key: 500 RPM
  - Paid tiers: up to 5,000 RPM
  - Free signup grants 10 million tokens on first API key; tokens are consumed per response by content length
  - Rate limit headers: `X-RateLimit-*` headers surface remaining quota
  - 402 error: quota exhausted or insufficient credits
  - 429 error: rate limit exceeded (implement exponential backoff)
- **Response format**: 
  - Default output is **JSON** with title, content (as clean markdown), URL, timestamp
  - Supports markdown, HTML, text, JSON, screenshot formats via headers
  - Markdown output is LLM-optimized (suitable for distill voice notes)
- **Fallback strategy when rate-limited**:
  - Jina Reader doesn't have built-in fallback; implement in distill:
    - Primary: Jina Reader (500 RPM with free key)
    - Tier 2: Mozilla Readability (@mozilla/readability) via Node.js + jsdom
    - Tier 3: Cheerio for lightweight HTML extraction when Tier 2 unavailable
  - For offline/archived URLs: store as plaintext or cached markdown

## 2. whisper.cpp

- **Install on macOS**: 
  - `git clone https://github.com/ggerganov/whisper.cpp.git && cd whisper.cpp && cmake -B build && cmake --build build -j --config Release`
  - For Apple Silicon with Metal GPU: add `-DWHISPER_COREML=1` flag during cmake
  - Alternative: `brew install whisper-cpp` (if available in Homebrew)
- **Model download**: `sh ./models/download-ggml-model.sh [model_name]`
  - Models: tiny (75 MiB), base (142 MiB), small (466 MiB), medium (1.5 GiB), large-v3 (2.9 GiB)
  - Quantized variants available: `-q5_0` suffix reduces size (e.g., large-v3-q5_0: 1.1 GiB)
- **Recommended model for distill (30s voice notes, zh-CN + en-US)**:
  - **ggml-base**: 142 MiB, good accuracy for mixed language, reasonable latency on Apple Silicon
  - Rationale: base model supports multilingual transcription (handles both zh-CN and en-US automatically), memory footprint ~500 MB–1 GB suitable for CLI tool, faster than medium/large
- **CLI invocation**:
  - Input: `./build/bin/whisper-cli -m models/ggml-base.en.bin -f audio.wav`
  - Language detection: automatic (multi-language model, no explicit language flag needed)
  - For explicit language hints: `-l zh` or `-l en` flags available in Whisper
  - Audio format required: 16-bit PCM WAV (convert mp3 via ffmpeg: `ffmpeg -i input.mp3 -ar 16000 -ac 1 -c:a pcm_s16le output.wav`)
- **Latency on Apple Silicon**: 
  - uncertain (docs reference benchmark issue #89 for specifics; typical: 5–10s for 10-second clip on M1, depends on model)
  - Inference is CPU-friendly with Metal GPU acceleration available
- **Model file size & memory**: Base model ~142 MiB on disk; runtime memory ~500 MB–1 GB (varies by model)

## 3. edge-tts (Python package)

- **Install**: `pipx install edge-tts` (recommended for CLI-only) or `pip install edge-tts`
- **Voice list for zh-CN** (recommended 3):
  - Eddy (Chinese (China mainland)) — neutral, widely compatible
  - Xiaoxiao (uncertain if available in distill version; edge-tts lists voices dynamically)
  - Yunxi (uncertain availability; cross-reference with `edge-tts --list-voices` output)
- **Voice list for en-US** (recommended 3):
  - Eddy (English (US)) — neutral, consistent quality
  - Flo (English (US)) — friendly tone, distinct from Eddy
  - Arthur or Steffan (uncertain exact availability; list via CLI)
- **CLI usage**: 
  - `edge-tts --voice "Eddy (Chinese (China mainland))" --text "你好世界" --write-media output.mp3`
  - Output format: **MP3 only** (primary); also generates SRT subtitles with `--write-subtitles output.srt`
  - Customization: `--rate=+10%` (speech rate), `--volume=+0%` (volume), `--pitch=+0Hz` (pitch)
- **Known reliability issues**:
  - **Critical**: edge-tts reverse-engineers Microsoft Edge's text-to-speech service; no SLA guarantee
  - Microsoft could change endpoint/protocol, breaking edge-tts (mitigate: maintain distill fallback to macOS `say`)
  - Rate limits: uncertain (no official limits documented; recommend timeout of 60s per request)
- **Latency for 100-char input**: uncertain (typical: 2–5s for audio generation + download; cross-reference in Wave 1 testing)

## 4. macOS `say` command (Tier 1 fallback)

- **Chinese voices available** (zh_CN):
  - Tingting — native Mandarin quality voice (recommended as primary)
  - Eddy (Chinese (China mainland)) — neutral, synthetic but clear
  - Flo (Chinese (China mainland)) — alternative option
  - Note: Quality is lower than edge-tts; use as fallback only
- **English voices available** (en_US):
  - Daniel — standard, professional tone (recommended)
  - Eddy (English (US)) — consistent quality, alternative
  - Fred — older voice, usable fallback
  - Multiple others (Albert, Bad News, Bells, Bubbles, etc.) — novelty voices
- **Output to file**: 
  - `say -v "Tingting" --output-file=out.aiff "你好"` outputs AIFF format
  - uncertain: can output MP3 directly; may need `--file-format=` flags or conversion to MP3 post-generation
  - Audio formats supported: AIFF (default), CAFF, m4af, WAVE
- **Latency**: Offline/immediate (no network dependency); synthesis time ~1–3s for typical 100-char phrase
- **Offline behavior**: Fully offline, no internet required; voices pre-installed on macOS

## 5. Mozilla Readability / Node.js HTML parser alternatives

- **@mozilla/readability** (npm package):
  - **Node.js compatibility**: Yes, but requires external DOM implementation (jsdom)
  - **Dependencies**: jsdom is mandatory for Node.js (Readability itself has zero production deps)
  - **Setup**: `npm install @mozilla/readability jsdom`
  - **Security consideration**: jsdom disables script execution and remote resource fetching by default (keep this setting)
  - **Usage**: Parse JSDOM document, pass to Readability constructor, extract `.content` property
  - **Maintenance**: 11,118 GitHub stars, 535 commits, active maintenance (last push 2026-01-21)
  - **Recommended**: For Tier 2 fallback after Jina Reader rate-limits

- **Alternatives comparison**:
  - **Cheerio**: 30,279 stars, last push 2026-04-21 (TODAY), TypeScript-first, jQuery syntax, lightweight (parse5-based)
    - Best for: simple extraction, speed, low memory footprint
  - **Postlight Parser** (@postlight/parser): 5.8k stars, last release Oct 2022 (older), dual Apache/MIT license
    - Status: potentially unmaintained; avoid for Wave 1
  - **node-unfluff**: Repository not found (404); likely abandoned, do not use
  - **article-parser**: Unable to verify from npm; uncertain status

- **Which to use for Tier 2 fallback**:
  - **Primary recommendation**: @mozilla/readability + jsdom (proven, Mozilla-backed, active maintenance)
  - **Lightweight alternative**: Cheerio (if memory constraints; no DOM simulation, just parsing)

## Integration recommendations (for Wave 1)

1. **Jina Reader concurrency**: Use `p-limit` with concurrency 5 when fetching 20+ bookmarks; set 10s timeout per request to avoid hanging on slow endpoints
2. **Whisper.cpp model selection**: Start with `ggml-base` (not tiny or small); it balances accuracy and latency for mixed zh-CN/en-US voice notes
3. **Whisper.cpp audio format**: Pre-convert any input (mp3, m4a, aac) to 16-bit PCM WAV using ffmpeg before passing to whisper-cli
4. **edge-tts registration**: Wrap in distill adapter with 60s timeout and explicit error handling; fall back to macOS `say` on timeout or service unavailability
5. **Readability fallback chain**: On Jina 429/402 error, try @mozilla/readability + jsdom (requires fetch + DOM parse ~2–3s), then Cheerio (light extraction), then plaintext
6. **macOS `say` as ultimate fallback**: For TTS, default to edge-tts, but register `say -v Tingting` for zh-CN and `say -v Daniel` for en-US as synchronous fallback (no network required)
7. **Error telemetry**: Log which tool succeeded (Jina vs Readability vs Cheerio, edge-tts vs say) to inform Wave 1 reliability metrics

## Risks discovered

1. **edge-tts reverse-engineering fragility**: Microsoft Edge TTS endpoint is not official; Microsoft could change protocol, breaking edge-tts with no warning. Mitigation: maintain macOS `say` fallback as guaranteed on-device TTS.
2. **Jina Reader free tier bottleneck**: 20 RPM without API key (200 requests/day) insufficient for morning fetch of 20+ bookmarks. Must obtain free API key at signup to reach 500 RPM (sufficient for ~1k bookmarks/day).
3. **whisper.cpp model download latency**: Large models (medium: 1.5 GiB, large: 2.9 GiB) require first-run download; base model (142 MiB) is acceptable for distill CLI install size. If users omit pre-download, cold start adds 1–5 minutes.
4. **jsdom memory overhead**: @mozilla/readability + jsdom has higher memory footprint than Cheerio (100+ MB per document parse); for high concurrency, may hit memory limits on resource-constrained machines.
5. **macOS voice quality lower than edge-tts**: Tingting and Eddy voices sound synthetic compared to edge-tts; fallback acceptable but noticeable drop in UX if edge-tts unavailable.

## Uncertainties (need to verify in Wave 1)

1. **edge-tts rate limits and latency**: Docs don't specify rate limits; latency for typical 100-char phrases is estimated 2–5s but untested. Wave 1 should benchmark live TTS generation on target hardware.
2. **whisper.cpp latency on Apple Silicon for 10s clips**: Benchmark issue #89 referenced in docs but not linked; exact latency for base model on M1/M2 uncertain. Run wave-1 benchmark before committing.
3. **Jina Reader response header semantics**: Which headers surface remaining quota? `X-RateLimit-Remaining` uncertain; docs reference "rate limit headers" generically. Verify API response headers in live test.
4. **edge-tts voice list stability**: Voice names and availability may vary by Microsoft update; `--list-voices` output should be dynamic-fetched in distill, not hardcoded. Verify zh-CN voice availability (Xiaoxiao, Yunxi) in live test.
5. **macOS `say` output format for MP3**: Docs list m4af and caff as supported formats; MP3 support uncertain. Test `say --file-format=m4af` vs post-ffmpeg conversion to MP3.

