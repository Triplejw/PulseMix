# The audio engine

The reusable code is in `engine/include/pulsemix/dsp.hpp` and `engine/src/dsp.cpp`.

## Stereo width is not channel volume

For samples `L` and `R`:

```text
mid  = (L + R) / 2
side = (L - R) / 2

output L = mid + width × side
output R = mid - width × side
```

- Width 0: both outputs equal the mono mid signal.
- Width 1: reconstruct the original stereo pair.
- Width >1: amplify the difference while preserving the center.

If left and right are identical, widening does nothing. Try the generated demo, watch the vectorscope, then choose Mono check. Increasing width can increase peaks and expose out-of-phase content. Correlation near +1 means similar channels; negative correlation indicates opposing content. Silence displays zero.

## Signal chain

```text
Input sanitation → Mid/side width → Low shelf → Mid bell → High shelf
                 → Master and channel gain → Balance → Linked peak guard
                 → Smoothed dry/wet bypass
```

Gains use `10^(dB/20)`. Balance attenuates one channel; center preserves both. Three fixed-frequency RBJ biquad filters provide low shelf (150 Hz), peaking EQ (1 kHz, Q=sqrt(1/2)), and high shelf (4 kHz). At low sample rates, filter centers are clamped to 40% of the rate. The response graph uses equivalent Web Audio coefficients at the playback rate.

Parameters and filter coefficients transition with a 10 ms one-pole smoothing constant. Offline export sets parameters and resets the engine before the first sample; interactive changes glide toward their new targets. Filter state resets on playback restart/seek. Seeking and loop boundaries are not crossfaded, so discontinuous material can still click at those boundaries.

The peak guard scales both channels by the same amount when either exceeds ±1. It preserves their instantaneous ratio. It is an instantaneous protective gain reduction, **not** a lookahead mastering limiter or compressor. Bypass restores the dry signal, including peaks in the original file.

## Real-time ownership

`Engine::process` does no memory allocation, file I/O, GUI work, or locking. The WASM bridge preallocates two planar 2,048-frame buffers. The worklet caches its common render-quantum views and handles other supported block sizes using a loop. It rejects quanta larger than 2,048 frames. Parameter calculation occurs between render callbacks on the same thread.

The native CLI uses libsndfile and bounded block buffers. Its file I/O is appropriate for offline rendering. File handles use RAII. Unlike the original prototype, no real-time callback reads a file or grows waveform history.

## Preview versus export

Browser playback runs at the audio device's AudioContext rate, which can differ from the file rate. Native export stays at the source rate. The same algorithms and settings are used, but browser resampling means those outputs are not necessarily sample-identical across rates. Tests compare matching-rate native and WASM samples with a maximum absolute error of 0.00002.

Export stores 32-bit floating-point samples and the full source duration. It does not bake in playback loop repetition or live parameter automation. Disabling peak protection can produce float samples above 0 dBFS, which downstream players may clip.

## Useful experiments

1. Load demo → width 0: the stereo scope becomes a vertical mid line.
2. Width 1 → 2: the side spread expands while centered bass stays centered.
3. Set master −6.02 dB: amplitudes roughly halve; energy becomes one quarter.
4. Boost mid +6 dB: observe the response graph and spectrum around 1 kHz.
5. Save a preset, change settings, swap A/B: each snapshot retains its edits.
6. Export, import the export, and compare source meters with the processing bypassed.
