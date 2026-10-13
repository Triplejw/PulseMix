import { useMemo } from 'react';
import { type Asset, time } from '../types';

export default function Waveform({ asset, position, loop, onSeek }: {
  asset: Asset | null; position: number; loop: { enabled: boolean; start: number; end: number }; onSeek: (position: number) => void;
}) {
  const paths = useMemo(() => [0, 1].map((channel) => {
    if (!asset) return '';
    return asset.waveform.map((bucket, i) => {
      const x = i / asset.waveform.length * 1000;
      const center = channel === 0 ? 48 : 138;
      return `M${x.toFixed(2)},${(center - bucket[channel * 2 + 1] * 36).toFixed(2)}V${(center - bucket[channel * 2] * 36).toFixed(2)}`;
    }).join(' ');
  }), [asset]);
  const duration = asset?.duration || 1;
  return <div className="waveform-wrap">
    <div className="channel-labels"><span>L</span><span>R</span></div>
    <svg className="waveform" viewBox="0 0 1000 180" preserveAspectRatio="none" role="img" aria-label="Stereo waveform; use the seek slider to navigate"
      onClick={(event) => { if (asset) { const rect = event.currentTarget.getBoundingClientRect(); onSeek((event.clientX - rect.left) / rect.width * asset.duration); } }}>
      <defs><linearGradient id="wave-left"><stop stopColor="#b9f76a"/><stop offset="1" stopColor="#73d8b8"/></linearGradient></defs>
      {[0, 200, 400, 600, 800, 1000].map((x) => <line key={x} x1={x} x2={x} y1="0" y2="180" stroke="#202c34" strokeDasharray="2 5"/>)}
      {[48, 138].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="#24333d"/>)}
      {loop.enabled && <rect x={loop.start / duration * 1000} y="0" width={(loop.end - loop.start) / duration * 1000} height="180" fill="#b9f76a" opacity=".07"/>}
      {asset ? <><path d={paths[0]} stroke="url(#wave-left)" strokeWidth="1.4" opacity=".9"/><path d={paths[1]} stroke="#71baf6" strokeWidth="1.4" opacity=".75"/></> : <text x="500" y="94" textAnchor="middle" fill="#637681" fontSize="16">Your next sound starts here</text>}
      {asset && <line x1={position / duration * 1000} x2={position / duration * 1000} y1="0" y2="180" stroke="#f6fafc" strokeWidth="1.5"/>}
    </svg>
    <div className="waveform-times">{[0, 0.25, 0.5, 0.75, 1].map((fraction) => <span key={fraction}>{time((asset?.duration || 0) * fraction)}</span>)}</div>
  </div>;
}
