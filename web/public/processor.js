import createDsp from './dsp.js';

class PulseMixProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false;
    this.params = options.processorOptions.parameters;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'parameters') {
        this.params = data.parameters;
        if (this.ready) this.setParameters();
      } else if (data.type === 'reset' && this.ready) {
        this.module._dsp_reset(this.handle);
      } else if (data.type === 'dispose') {
        if (this.ready) this.module._dsp_destroy(this.handle);
        this.ready = false;
        this.disposed = true;
      }
    };
    const compiled = options.processorOptions.wasmModule;
    createDsp({
      instantiateWasm(imports, callback) {
        const instance = new WebAssembly.Instance(compiled, imports);
        callback(instance, compiled);
        return instance.exports;
      },
    }).then((module) => {
      if (this.disposed) return;
      this.module = module;
      this.handle = module._dsp_create(sampleRate);
      this.left = module.HEAPF32.subarray(module._dsp_left(this.handle) / 4, module._dsp_left(this.handle) / 4 + 2048);
      this.right = module.HEAPF32.subarray(module._dsp_right(this.handle) / 4, module._dsp_right(this.handle) / 4 + 2048);
      // Cache views outside process(); the render loop creates no JS heap objects.
      this.views = new Map();
      for (const frames of [128, 256, 512, 1024, 2048]) {
        this.views.set(frames, [this.left.subarray(0, frames), this.right.subarray(0, frames)]);
      }
      this.setParameters();
      module._dsp_reset(this.handle);
      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    }).catch((error) => this.port.postMessage({ type: 'error', message: String(error) }));
  }
  setParameters() {
    const p = this.params;
    this.module._dsp_set(this.handle, p.master_db, p.left_db, p.right_db, p.balance, p.width,
      p.low_db, p.mid_db, p.high_db, Number(p.bypass), Number(p.limiter));
  }
  process(inputs, outputs) {
    if (this.disposed) return false;
    const output = outputs[0];
    if (!this.ready || !output?.[0]) return true;
    const frames = output[0].length;
    if (frames > 2048) return true;
    const input = inputs[0];
    if (input?.[0]) this.left.set(input[0]); else this.left.fill(0, 0, frames);
    if (input?.[1]) this.right.set(input[1]);
    else if (input?.[0]) this.right.set(input[0]);
    else this.right.fill(0, 0, frames);
    this.module._dsp_process(this.handle, frames);
    const views = this.views.get(frames);
    if (views) {
      output[0].set(views[0]);
      if (output[1]) output[1].set(views[1]);
    } else {
      for (let i = 0; i < frames; i++) {
        output[0][i] = this.left[i];
        if (output[1]) output[1][i] = this.right[i];
      }
    }
    return true;
  }
}
registerProcessor('pulsemix-dsp', PulseMixProcessor);
