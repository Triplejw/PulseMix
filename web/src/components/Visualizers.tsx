import { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../audio';
import { db } from '../types';

interface Stats { peak: number[]; rms: number[]; clip: boolean[]; correlation: number }
const empty: Stats = { peak: [0, 0], rms: [0, 0], clip: [false, false], correlation: 0 };

function canvasContext(canvas: HTMLCanvasElement) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext('2d')!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

export default function Visualizers({ engine }: { engine: AudioEngine }) {
  const spectrum = useRef<HTMLCanvasElement>(null), scope = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<Stats>(empty);
  useEffect(() => {
    const frequency = new Uint8Array(1024);
    const left = new Float32Array(2048), right = new Float32Array(2048);
    const lastClip = [0, 0];
    let frame = 0, lastUpdate = 0;
    function draw(now: number) {
      frame = requestAnimationFrame(draw);
      if (!spectrum.current || !scope.current) return;
      if (engine.playing && engine.analyser) {
        engine.analyser.getByteFrequencyData(frequency);
        engine.channels[0].getFloatTimeDomainData(left);
        engine.channels[1].getFloatTimeDomainData(right);
      } else { frequency.fill(0); left.fill(0); right.fill(0); }
      const { context: c, width: w, height: h } = canvasContext(spectrum.current);
      c.strokeStyle = '#213039'; c.lineWidth = 1;
      for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(0, h * i / 4); c.lineTo(w, h * i / 4); c.stroke(); }
      const upper = Math.min(20000, (engine.context?.sampleRate || 48000) / 2);
      c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 2) {
        const hz = 20 * (upper / 20) ** (x / Math.max(1, w));
        const index = Math.min(1023, Math.round(hz * 2048 / (engine.context?.sampleRate || 48000)));
        c.lineTo(x, h - frequency[index] / 255 * h * 0.92);
      }
      c.lineTo(w, h); c.closePath();
      const gradient = c.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, '#b9f76a66'); gradient.addColorStop(1, '#b9f76a04');
      c.fillStyle = gradient; c.fill(); c.strokeStyle = '#b9f76a'; c.stroke();
      const { context: s, width: sw, height: sh } = canvasContext(scope.current);
      const radius = Math.min(sw, sh) * 0.42, cx = sw / 2, cy = sh / 2;
      s.strokeStyle = '#263640'; s.lineWidth = 1;
      s.beginPath(); s.arc(cx, cy, radius, 0, Math.PI * 2); s.stroke();
      s.beginPath(); s.moveTo(cx, cy - radius); s.lineTo(cx, cy + radius); s.moveTo(cx - radius, cy); s.lineTo(cx + radius, cy); s.stroke();
      s.fillStyle = '#637681'; s.font = '10px monospace';
      s.fillText('M', cx + 5, cy - radius + 10); s.fillText('S', cx + radius - 12, cy - 6);
      s.strokeStyle = '#71baf6aa'; s.beginPath();
      for (let i = 0; i < left.length; i += 4) {
        const x = cx + (left[i] - right[i]) * 0.5 * radius;
        const y = cy - (left[i] + right[i]) * 0.5 * radius;
        if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
      }
      s.stroke();
      if (now - lastUpdate > 100) {
        const peak = [0, 0], square = [0, 0]; let cross = 0;
        for (let i = 0; i < left.length; i++) {
          peak[0] = Math.max(peak[0], Math.abs(left[i])); peak[1] = Math.max(peak[1], Math.abs(right[i]));
          square[0] += left[i] ** 2; square[1] += right[i] ** 2; cross += left[i] * right[i];
        }
        peak.forEach((value, channel) => { if (value >= 0.9999) lastClip[channel] = now; });
        const energy = Math.sqrt(square[0] * square[1]);
        setStats({ peak, rms: square.map((value) => Math.sqrt(value / left.length)),
          clip: lastClip.map((at) => at > 0 && now - at < 1500), correlation: energy > 1e-12 ? cross / energy : 0 });
        lastUpdate = now;
      }
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine]);
  return <div className="visualizer-grid">
    <section className="panel spectrum-panel"><div className="panel-title"><h2>Frequency spectrum</h2><span className="tag">LIVE FFT</span></div>
      <canvas ref={spectrum} aria-label="Live frequency spectrum"/>
      <div className="range-labels"><span>20 Hz</span><span>100</span><span>1k</span><span>10k</span><span>20k</span></div>
    </section>
    <section className="panel scope-panel"><div className="panel-title"><h2>Stereo scope</h2><span className="tag">M / S</span></div>
      <canvas ref={scope} aria-label="Mid/side stereo vectorscope"/>
      <div className="correlation"><span>Phase correlation</span><strong className={stats.correlation < -0.1 ? 'danger' : ''}>{stats.correlation.toFixed(2)}</strong></div>
      <div className="correlation-track"><i style={{ left: `${(stats.correlation + 1) / 2 * 100}%` }}/></div>
    </section>
    <section className="panel meters-panel"><div className="panel-title"><h2>Output meters</h2><span className="tag">dBFS</span></div>
      {[0, 1].map((channel) => <div className="meter-channel" key={channel}>
        <div className="meter-label"><strong>{channel === 0 ? 'LEFT' : 'RIGHT'}</strong><span className={stats.clip[channel] ? 'clip lit' : 'clip'}>PEAK</span></div>
        <div className="meter-track"><div className="meter-peak" style={{ width: `${Math.max(0, Math.min(100, (db(stats.peak[channel]) + 60) / 60 * 100))}%` }}/><div className="meter-rms" style={{ width: `${Math.max(0, Math.min(100, (db(stats.rms[channel]) + 60) / 60 * 100))}%` }}/></div>
        <div className="meter-values"><span>Peak <b>{stats.peak[channel] ? db(stats.peak[channel]).toFixed(1) : '−∞'}</b></span><span>RMS <b>{stats.rms[channel] ? db(stats.rms[channel]).toFixed(1) : '−∞'}</b></span></div>
      </div>)}
      <div className="range-labels"><span>−60</span><span>−30</span><span>−12</span><span>0</span></div>
    </section>
  </div>;
}
