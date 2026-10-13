import { neutral, type Parameters } from './types';

export class AudioEngine {
  context: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  buffer: AudioBuffer | null = null;
  source: AudioBufferSourceNode | null = null;
  analyser: AnalyserNode | null = null;
  channels: AnalyserNode[] = [];
  playing = false;
  offset = 0;
  startedAt = 0;
  loop = { enabled: false, start: 0, end: 0 };
  private parameters: Parameters = { ...neutral };
  private initialization: Promise<void> | null = null;
  private playbackEpoch = 0;
  onError: (error: Error) => void = () => {};

  async initialize() {
    if (!this.initialization) this.initialization = this.setup().catch(async (error) => {
      await this.context?.close();
      this.context = null; this.node = null; this.initialization = null;
      throw error;
    });
    return this.initialization;
  }

  private async setup() {
    if (!window.AudioContext || !window.isSecureContext) throw new Error('AudioWorklet needs a modern browser on localhost or HTTPS.');
    const context = this.context = new AudioContext();
    await context.suspend();
    if (!context.audioWorklet) throw new Error('This browser does not support AudioWorklet.');
    const response = await fetch('/dsp.wasm');
    if (!response.ok) throw new Error('The C++ WebAssembly engine is missing. Rebuild the web image.');
    const wasmModule = await WebAssembly.compile(await response.arrayBuffer());
    await context.audioWorklet.addModule('/processor.js');
    const node = this.node = new AudioWorkletNode(context, 'pulsemix-dsp', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete',
      processorOptions: { wasmModule, parameters: this.parameters },
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Audio engine initialization timed out.')), 15000);
      node.port.onmessage = ({ data }) => {
        if (data.type === 'ready' || data.type === 'error') {
          window.clearTimeout(timeout);
          if (data.type === 'error') reject(new Error(data.message)); else resolve();
        }
      };
      node.onprocessorerror = () => { window.clearTimeout(timeout); reject(new Error('The audio processor failed to initialize.')); };
    });
    node.onprocessorerror = () => { this.pause(); this.onError(new Error('The audio processor stopped. Reload the page to reinitialize it.')); };
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;
    node.connect(this.analyser);
    this.analyser.connect(context.destination);
    const split = context.createChannelSplitter(2);
    node.connect(split);
    this.channels = [context.createAnalyser(), context.createAnalyser()];
    this.channels.forEach((analyser, channel) => {
      analyser.fftSize = 2048;
      split.connect(analyser, channel);
      // Silent destination connection keeps Safari's analysis graph active.
      const mute = context.createGain(); mute.gain.value = 0;
      analyser.connect(mute); mute.connect(context.destination);
    });
  }

  async load(bytes: ArrayBuffer) {
    await this.initialize();
    this.pause();
    this.buffer = null;
    this.offset = 0;
    this.buffer = await this.context!.decodeAudioData(bytes);
    this.node!.port.postMessage({ type: 'reset' });
  }

  setParameters(parameters: Parameters) {
    this.parameters = parameters;
    this.node?.port.postMessage({ type: 'parameters', parameters });
  }

  setLoop(enabled: boolean, start: number, end: number) {
    this.loop = { enabled: enabled && end - start >= 0.05, start, end };
    if (this.source) {
      this.source.loop = this.loop.enabled;
      this.source.loopStart = start; this.source.loopEnd = end;
      if (this.loop.enabled && (this.position < start || this.position >= end)) this.seek(start);
    }
  }

  get position() {
    if (!this.playing || !this.context) return this.offset;
    const elapsed = this.offset + this.context.currentTime - this.startedAt;
    if (this.loop.enabled && elapsed >= this.loop.end)
      return this.loop.start + (elapsed - this.loop.start) % (this.loop.end - this.loop.start);
    return Math.min(this.buffer?.duration || 0, elapsed);
  }

  async play() {
    if (!this.buffer || this.playing) return;
    const epoch = this.playbackEpoch, buffer = this.buffer;
    await this.context!.resume();
    if (this.playing || epoch !== this.playbackEpoch || buffer !== this.buffer) return;
    if (this.offset >= this.buffer.duration - 0.001) this.offset = 0;
    if (this.loop.enabled && (this.offset < this.loop.start || this.offset >= this.loop.end)) this.offset = this.loop.start;
    const source = this.source = this.context!.createBufferSource();
    source.buffer = this.buffer;
    source.loop = this.loop.enabled; source.loopStart = this.loop.start; source.loopEnd = this.loop.end;
    source.connect(this.node!);
    this.node!.port.postMessage({ type: 'reset' });
    this.startedAt = this.context!.currentTime;
    this.playing = true;
    source.onended = () => {
      source.disconnect();
      if (this.source === source) { this.playing = false; this.source = null; this.offset = 0; }
    };
    source.start(0, this.offset);
  }

  pause() {
    this.playbackEpoch++;
    this.offset = this.position;
    this.playing = false;
    const source = this.source; this.source = null;
    if (source) { source.onended = null; source.stop(); source.disconnect(); }
  }

  seek(position: number) {
    const wasPlaying = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(this.buffer?.duration || 0, position));
    if (wasPlaying) void this.play().catch((error: Error) => this.onError(error));
  }

  async dispose() {
    this.pause(); this.node?.port.postMessage({ type: 'dispose' });
    this.node?.disconnect(); await this.context?.close();
  }
}
