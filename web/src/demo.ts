// A generated stereo fixture makes the workbench explorable without downloading music.
export function demoFile() {
  const rate = 48000, frames = rate * 12;
  const buffer = new ArrayBuffer(44 + frames * 4), view = new DataView(buffer);
  const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 4, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    const t = i / rate, beat = t % 0.5, envelope = Math.min(1, t * 2) * Math.min(1, (12 - t) * 2);
    const bass = Math.sin(2 * Math.PI * 65.406 * t) * 0.14;
    const kick = Math.sin(2 * Math.PI * (55 * beat + 8 * (1 - Math.exp(-beat * 35)))) * Math.exp(-beat * 20) * 0.28;
    const chord = [261.626, 329.628, 391.995].reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * t) * 0.04, 0);
    const shimmerL = Math.sin(2 * Math.PI * 523.251 * t) * (0.05 + 0.035 * Math.sin(t * 2));
    const shimmerR = Math.sin(2 * Math.PI * 659.255 * t) * (0.05 - 0.035 * Math.sin(t * 2));
    view.setInt16(44 + i * 4, (bass + kick + chord + shimmerL) * envelope * 32767, true);
    view.setInt16(46 + i * 4, (bass + kick + chord + shimmerR) * envelope * 32767, true);
  }
  return new File([buffer], 'PulseMix — midnight session.wav', { type: 'audio/wav' });
}
