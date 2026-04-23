import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DistillVoiceSTTBackend } from '../types.js';

const execFileAsync = promisify(execFile);

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
  length: number;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorLike extends Event {
  error?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface DistillSpeechSessionOptions {
  backend: DistillVoiceSTTBackend;
  language: string;
  whisperBinary: string;
  whisperModelPath: string;
  onTranscript: (value: string) => void;
  onStatus: (value: string) => void;
}

function expandHome(value: string): string {
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function normalizeWhisperLanguage(language: string): string {
  if (!language || language === 'auto') {
    return 'auto';
  }
  return language.split('-')[0] ?? language;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const globalWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return globalWindow.SpeechRecognition ?? globalWindow.webkitSpeechRecognition ?? null;
}

class BrowserSpeechPreview {
  private readonly recognition: SpeechRecognitionLike;
  private finalTranscript = '';
  private currentTranscript = '';
  private stopResolve: ((value: string) => void) | null = null;
  private stopReject: ((reason?: unknown) => void) | null = null;
  private aborted = false;

  private constructor(
    language: string,
    private readonly onTranscript: (value: string) => void,
  ) {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      throw new Error('Web Speech API is unavailable in this Obsidian runtime.');
    }

    this.recognition = new Ctor();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = language === 'auto' ? 'en-US' : language;
    this.recognition.onresult = (event) => {
      let finalTranscript = this.finalTranscript;
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) {
          continue;
        }
        const transcript = result?.[0]?.transcript?.trim() ?? '';
        if (!transcript) {
          continue;
        }

        if (result.isFinal) {
          finalTranscript = `${finalTranscript} ${transcript}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${transcript}`.trim();
        }
      }

      this.finalTranscript = finalTranscript;
      this.currentTranscript = [finalTranscript, interimTranscript].filter(Boolean).join(' ').trim();
      this.onTranscript(this.currentTranscript);
    };
    this.recognition.onerror = (event) => {
      if (this.stopReject && event.error && event.error !== 'aborted') {
        this.stopReject(new Error(`Speech recognition failed: ${event.error}`));
        this.clearPending();
      }
    };
    this.recognition.onend = () => {
      if (this.aborted) {
        return;
      }

      if (this.stopResolve) {
        this.stopResolve(this.currentTranscript || this.finalTranscript);
        this.clearPending();
      }
    };
  }

  static isAvailable(): boolean {
    return getSpeechRecognitionCtor() !== null;
  }

  static create(
    language: string,
    onTranscript: (value: string) => void,
  ): BrowserSpeechPreview {
    return new BrowserSpeechPreview(language, onTranscript);
  }

  start(): void {
    this.recognition.start();
  }

  async stop(): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      this.stopResolve = resolve;
      this.stopReject = reject;
      this.recognition.stop();
    });
  }

  async abort(): Promise<void> {
    this.aborted = true;
    this.clearPending();
    this.recognition.abort();
  }

  private clearPending(): void {
    this.stopResolve = null;
    this.stopReject = null;
  }
}

class AudioCapture {
  private readonly chunks: BlobPart[] = [];
  private readonly recorder: MediaRecorder;
  private readonly stream: MediaStream;

  private constructor(stream: MediaStream, recorder: MediaRecorder) {
    this.stream = stream;
    this.recorder = recorder;
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
  }

  static async create(): Promise<AudioCapture> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = AudioCapture.pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    return new AudioCapture(stream, recorder);
  }

  private static pickMimeType(): string | undefined {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];

    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  }

  start(): void {
    this.recorder.start(250);
  }

  async stop(): Promise<Blob> {
    return await new Promise<Blob>((resolve) => {
      this.recorder.onstop = () => {
        this.release();
        resolve(new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' }));
      };
      this.recorder.stop();
    });
  }

  async cancel(): Promise<void> {
    if (this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    this.release();
  }

  private release(): void {
    this.stream.getTracks().forEach((track) => track.stop());
  }
}

function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numberOfChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples * blockAlign);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples * blockAlign, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, samples * blockAlign, true);

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sample = audioBuffer.getChannelData(channel)[i] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return buffer;
}

async function blobToWavBuffer(blob: Blob): Promise<Buffer> {
  const bytes = await blob.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const decoded = await audioContext.decodeAudioData(bytes.slice(0));
    return Buffer.from(audioBufferToWav(decoded));
  } finally {
    await audioContext.close();
  }
}

async function transcribeWithWhisper(
  blob: Blob,
  options: Pick<
    DistillSpeechSessionOptions,
    'language' | 'whisperBinary' | 'whisperModelPath'
  >,
): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'distill-voice-'));
  const audioPath = path.join(tempDir, 'input.wav');
  const outputBase = path.join(tempDir, 'transcript');

  try {
    await writeFile(audioPath, await blobToWavBuffer(blob));
    await execFileAsync(options.whisperBinary, [
      '-m',
      expandHome(options.whisperModelPath),
      '-f',
      audioPath,
      '-l',
      normalizeWhisperLanguage(options.language),
      '-otxt',
      '-of',
      outputBase,
      '-np',
      '-nt',
    ]);

    const transcript = await readFile(`${outputBase}.txt`, 'utf8');
    return transcript.trim();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export class DistillSpeechSession {
  private preview: BrowserSpeechPreview | null = null;
  private capture: AudioCapture | null = null;

  private constructor(private readonly options: DistillSpeechSessionOptions) {}

  static async start(options: DistillSpeechSessionOptions): Promise<DistillSpeechSession> {
    const session = new DistillSpeechSession(options);
    await session.begin();
    return session;
  }

  private async begin(): Promise<void> {
    if (this.options.backend === 'macos-native') {
      if (!BrowserSpeechPreview.isAvailable()) {
        throw new Error('macos-native requires Web Speech support in the current Obsidian runtime.');
      }
      this.preview = BrowserSpeechPreview.create(
        this.options.language,
        this.options.onTranscript,
      );
      this.preview.start();
      this.options.onStatus('Listening with native speech recognition');
      return;
    }

    this.capture = await AudioCapture.create();
    this.capture.start();

    if (BrowserSpeechPreview.isAvailable()) {
      this.preview = BrowserSpeechPreview.create(
        this.options.language,
        this.options.onTranscript,
      );
      this.preview.start();
      this.options.onStatus('Recording locally with live browser transcript preview');
      return;
    }

    this.options.onStatus('Recording locally. Final transcript will appear after stop.');
  }

  async stop(): Promise<string> {
    const previewPromise = this.preview ? this.preview.stop() : Promise.resolve('');
    const audioPromise = this.capture ? this.capture.stop() : Promise.resolve<Blob | null>(null);

    const [previewTranscript, audioBlob] = await Promise.all([previewPromise, audioPromise]);

    if (this.options.backend === 'whisper-cli') {
      if (!audioBlob) {
        throw new Error('No audio was captured for whisper-cli transcription.');
      }

      this.options.onStatus('Transcribing locally with whisper-cli');
      const transcript = await transcribeWithWhisper(audioBlob, this.options);
      const finalTranscript = transcript.trim() || previewTranscript.trim();
      this.options.onTranscript(finalTranscript);
      this.options.onStatus('Transcript ready');
      return finalTranscript;
    }

    const finalTranscript = previewTranscript.trim();
    this.options.onStatus('Transcript ready');
    return finalTranscript;
  }

  async cancel(): Promise<void> {
    if (this.preview) {
      await this.preview.abort();
    }
    if (this.capture) {
      await this.capture.cancel();
    }
  }
}
