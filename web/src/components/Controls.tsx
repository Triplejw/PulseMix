import { useId, useMemo } from 'react';
import { type Parameters } from '../types';

type NumericKey = Exclude<keyof Parameters, 'bypass' | 'limiter'>;
export function Slider({ label, value, min, max, step = 0.1, unit = 'dB', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
  const id = useId();
  return <div className="control">
    <label className="control-label" htmlFor={id}>{label}<span className="control-value">{value > 0 && unit === 'dB' ? '+' : ''}{value.toFixed(step < 0.1 ? 2 : 1)} <small>{unit}</small></span></label>
    <input id={id} aria-label={label} type="range" min={min} max={max} step={step} value={value}
      style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties}
      onChange={(event) => onChange(Number(event.target.value))} />
    <span className="range-labels"><span>{min}</span><span>{max}</span></span>
  </div>;
}

export function EqCurve({ parameters, sampleRate }: { parameters: Parameters; sampleRate: number }) {
  const path = useMemo(() => {
    const context = new OfflineAudioContext(1, 1, sampleRate);
    const frequencies = new Float32Array(240);
    const total = new Float32Array(240).fill(1);
    const response = new Float32Array(240), phase = new Float32Array(240);
    const upper = Math.min(20000, sampleRate * 0.49);
    for (let i = 0; i < 240; i++) frequencies[i] = 20 * (upper / 20) ** (i / 239);
    (['lowshelf', 'peaking', 'highshelf'] as BiquadFilterType[]).forEach((type, band) => {
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = Math.min([150, 1000, 4000][band], sampleRate * 0.4);
      filter.Q.value = Math.SQRT1_2;
      filter.gain.value = [parameters.low_db, parameters.mid_db, parameters.high_db][band];
      filter.getFrequencyResponse(frequencies, response, phase);
      for (let i = 0; i < 240; i++) total[i] *= response[i];
    });
    return Array.from(total, (gain, i) => `${i ? 'L' : 'M'}${(i / 239 * 600).toFixed(1)},${(60 - Math.max(-18, Math.min(18, 20 * Math.log10(gain))) * 2.7).toFixed(1)}`).join(' ');
  }, [parameters.low_db, parameters.mid_db, parameters.high_db, sampleRate]);
  return <div className="eq-curve">
    <svg viewBox="0 0 600 120" role="img" aria-label="Equalizer frequency response">
      <defs><linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#b9f76a" stopOpacity=".15"/><stop offset="1" stopColor="#b9f76a" stopOpacity="0"/></linearGradient></defs>
      {[20, 60, 100].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#243039" strokeDasharray="3 5"/>)}
      {[100, 200, 300, 400, 500].map((x) => <line key={x} x1={x} x2={x} y1="0" y2="120" stroke="#1d2830"/>)}
      <path d={`${path} L600,120 L0,120 Z`} fill="url(#eq-fill)"/>
      <path d={path} fill="none" stroke="#b9f76a" strokeWidth="2"/>
    </svg>
    <div className="range-labels"><span>20 Hz</span><span>150 Hz</span><span>1 kHz</span><span>4 kHz</span><span>{Math.round(Math.min(20, sampleRate / 2000))} kHz</span></div>
  </div>;
}

export function ProcessingControls({ parameters, onChange, sampleRate }: {
  parameters: Parameters; onChange: (parameters: Parameters) => void; sampleRate: number;
}) {
  const change = (key: NumericKey, value: number) => onChange({ ...parameters, [key]: value });
  return <div className="processing-grid">
    <section className="panel">
      <div className="section-heading"><span className="eyebrow">01 / LEVEL</span><h2>Channel strip</h2></div>
      <Slider label="Master gain" value={parameters.master_db} min={-60} max={12} onChange={(value) => change('master_db', value)}/>
      <div className="two-columns">
        <Slider label="Left gain" value={parameters.left_db} min={-60} max={6} onChange={(value) => change('left_db', value)}/>
        <Slider label="Right gain" value={parameters.right_db} min={-60} max={6} onChange={(value) => change('right_db', value)}/>
      </div>
      <Slider label="Balance" value={parameters.balance} min={-1} max={1} step={0.01} unit="L / R" onChange={(value) => change('balance', value)}/>
      <label className="switch-row"><input type="checkbox" checked={parameters.limiter} onChange={(event) => onChange({ ...parameters, limiter: event.target.checked })}/><span>Linked peak guard</span><span className="tag">0 dBFS</span></label>
      <p className="hint">Instantaneous peak protection, linked across both channels.</p>
    </section>
    <section className="panel">
      <div className="section-heading"><span className="eyebrow">02 / SPACE</span><h2>Stereo field</h2></div>
      <div className="stereo-art" aria-hidden="true"><span>L</span><div className="stereo-orbit" style={{ transform: `scaleX(${0.35 + parameters.width * 0.55})` }}><i/><i/></div><span>R</span></div>
      <Slider label="Stereo width" value={parameters.width} min={0} max={2} step={0.01} unit="×" onChange={(value) => change('width', value)}/>
      <div className="width-modes">{[['Mono', 0], ['Original', 1], ['Wide', 1.5]].map(([label, value]) => <button key={label} className={parameters.width === value ? 'active' : ''} onClick={() => change('width', Number(value))}>{label}</button>)}</div>
      <p className="hint">Mid/side processing. The center stays put; width changes the difference between left and right.</p>
    </section>
    <section className="panel eq-panel">
      <div className="section-heading"><span className="eyebrow">03 / COLOR</span><h2>Three-band equalizer</h2></div>
      <EqCurve parameters={parameters} sampleRate={sampleRate}/>
      <div className="three-columns">
        <Slider label="Low shelf" value={parameters.low_db} min={-12} max={12} unit="dB · 150 Hz" onChange={(value) => change('low_db', value)}/>
        <Slider label="Mid bell" value={parameters.mid_db} min={-12} max={12} unit="dB · 1 kHz" onChange={(value) => change('mid_db', value)}/>
        <Slider label="High shelf" value={parameters.high_db} min={-12} max={12} unit="dB · 4 kHz" onChange={(value) => change('high_db', value)}/>
      </div>
    </section>
  </div>;
}
