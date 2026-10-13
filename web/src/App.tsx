import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio';
import { json, request } from './api';
import { demoFile } from './demo';
import { db, neutral, time, type Asset, type Parameters, type Preset, type Project } from './types';
import { ProcessingControls } from './components/Controls';
import Waveform from './components/Waveform';
import Visualizers from './components/Visualizers';

export default function App() {
  const [engine] = useState(() => new AudioEngine());
  const [asset, setAsset] = useState<Asset | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [parameters, setParameters] = useState<Parameters>({ ...neutral });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Untitled session');
  const [presetName, setPresetName] = useState('My preset');
  const [ready, setReady] = useState(false), [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState(0), [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState({ enabled: false, start: 0, end: 0 });
  const [compare, setCompare] = useState<'A' | 'B'>('A');
  const [snapshot, setSnapshot] = useState<Parameters>({ ...neutral });
  const fileInput = useRef<HTMLInputElement>(null);
  const operationActive = useRef(false);

  const refresh = useCallback(async () => {
    const [newAssets, newPresets, newProjects] = await Promise.all([
      request<Asset[]>('/assets'), request<Preset[]>('/presets'), request<Project[]>('/projects'),
    ]);
    setAssets(newAssets); setPresets(newPresets); setProjects(newProjects); setConnected(true);
  }, []);

  useEffect(() => {
    engine.onError = (err) => setError(err.message);
    void refresh().catch((err: Error) => setError(err.message));
    return () => { void engine.dispose(); };
  }, [engine, refresh]);
  useEffect(() => { engine.setParameters(parameters); }, [engine, parameters]);
  useEffect(() => { engine.setLoop(loop.enabled, loop.start, loop.end); }, [engine, loop]);
  useEffect(() => {
    const timer = window.setInterval(() => { setPosition(engine.position); setPlaying(engine.playing); }, 50);
    return () => window.clearInterval(timer);
  }, [engine]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const perform = useCallback(async (label: string, task: () => Promise<void>) => {
    if (operationActive.current) return;
    operationActive.current = true; setBusy(label); setError('');
    try { await task(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); }
    finally { operationActive.current = false; setBusy(''); }
  }, []);

  const loadAsset = async (item: Asset, project?: Project) => {
    engine.pause(); setReady(false);
    const response = await fetch(`/api/assets/${item.id}/audio`);
    if (!response.ok) throw new Error('Could not load audio.');
    await engine.load(await response.arrayBuffer());
    const nextParameters = project?.parameters || { ...neutral };
    engine.setParameters(nextParameters);
    setAsset(item); setParameters(nextParameters); setCompare('A'); setSnapshot({ ...neutral });
    setProjectId(project?.id || null); setProjectName(project?.name || item.name.replace(/\.[^.]+$/, ''));
    const nextLoop = { enabled: project?.loop_enabled || false, start: project?.loop_start || 0, end: project?.loop_end || item.duration };
    setLoop(nextLoop); engine.setLoop(nextLoop.enabled, nextLoop.start, nextLoop.end);
    setPosition(0); setPlaying(false); setReady(true);
  };

  const upload = (file: File) => perform('Decoding and analyzing audio…', async () => {
    if (file.size > 100 * 1024 * 1024) throw new Error('Maximum upload size is 100 MiB.');
    const form = new FormData(); form.append('file', file);
    const item = await request<Asset>('/assets', { method: 'POST', body: form });
    await refresh(); await loadAsset(item);
    setNotice('Audio loaded. Press space to play.');
  });

  const togglePlayback = useCallback(async () => {
    if (!ready || operationActive.current) return;
    try {
      if (engine.playing) engine.pause(); else await engine.play();
      setPlaying(engine.playing);
    } catch (err) { setError(err instanceof Error ? err.message : 'Playback failed.'); }
  }, [engine, ready]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable) return;
      if (event.code === 'Space') { event.preventDefault(); void togglePlayback(); }
      if (event.key.toLowerCase() === 'b') setParameters((p) => ({ ...p, bypass: !p.bypass }));
      if (event.key.toLowerCase() === 'l' && loop.end - loop.start >= 0.05) setLoop((l) => ({ ...l, enabled: !l.enabled }));
      if (event.key === 'ArrowRight') { event.preventDefault(); engine.seek(engine.position + 5); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); engine.seek(engine.position - 5); }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [engine, togglePlayback, loop.start, loop.end]);

  const saveProject = (asNew = false) => perform('Saving project…', async () => {
    if (!asset) return;
    const payload = { name: projectName.trim() || 'Untitled session', asset_id: asset.id, parameters,
      loop_start: loop.start, loop_end: loop.end, loop_enabled: loop.enabled };
    const project = await request<Project>(projectId && !asNew ? `/projects/${projectId}` : '/projects', json(projectId && !asNew ? 'PUT' : 'POST', payload));
    setProjectId(project.id); await refresh(); setNotice('Project saved to your Docker volume.');
  });

  const exportAudio = () => perform('Rendering with the native C++ engine…', async () => {
    if (!asset) return;
    const response = await fetch(`/api/assets/${asset.id}/export`, json('POST', parameters));
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.detail === 'string' ? body.detail : 'Export failed.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url;
    const stem = asset.name.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9._ -]/g, '-').trim() || 'audio';
    link.download = `${stem}-pulsemix.wav`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    setNotice('Exported stereo float WAV at the original sample rate.');
  });

  const switchCompare = () => {
    setSnapshot({ ...parameters }); setParameters({ ...snapshot }); setCompare(compare === 'A' ? 'B' : 'A');
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="PulseMix home"><svg width="32" height="32" viewBox="0 0 32 32"><path d="M2 16h5l4-10 5 21 5-17 4 6h5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"/></svg><span>PulseMix<span className="brand-dot">.</span></span></a>
      <span className="sidebar-kicker">THE AUDIO WORKBENCH</span>
      <div className="sidebar-section"><span className="eyebrow">WORKSPACE</span><div className="workspace-item"><span>◉</span> Stereo laboratory <span className="tag">2.0</span></div></div>
      <div className="sidebar-section"><div className="sidebar-heading"><span className="eyebrow">AUDIO LIBRARY</span><span>{assets.length.toString().padStart(2, '0')}</span></div>
        <button className="upload-button" disabled={!!busy} onClick={() => fileInput.current?.click()}>＋ Import audio</button>
        <div className="library-list">{assets.map((item) => <div className={`library-row ${asset?.id === item.id ? 'selected' : ''}`} key={item.id}>
          <button disabled={!!busy} onClick={() => void perform('Loading audio…', async () => loadAsset(await request<Asset>(`/assets/${item.id}`)))}><span className="file-icon">♫</span><span><strong>{item.name}</strong><small>{time(item.duration)} · {(item.sample_rate / 1000).toFixed(1)} kHz</small></span></button>
          <button className="delete-button" aria-label={`Delete audio ${item.name}`} disabled={!!busy || asset?.id === item.id} onClick={() => void perform('Removing audio…', async () => { await request(`/assets/${item.id}`, { method: 'DELETE' }); await refresh(); })}>×</button>
        </div>)}{!assets.length && <p className="hint">Your imported sounds live here.</p>}</div>
      </div>
      <div className="sidebar-section"><div className="sidebar-heading"><span className="eyebrow">SAVED SESSIONS</span><span>{projects.length.toString().padStart(2, '0')}</span></div>
        {projects.map((project) => <div className="project-row" key={project.id}><button disabled={!!busy} onClick={() => void perform('Restoring session…', async () => loadAsset(await request<Asset>(`/assets/${project.asset_id}`), project))}>↗ {project.name}</button><button className="delete-button" disabled={!!busy} aria-label={`Delete project ${project.name}`} onClick={() => void perform('Removing project…', async () => { await request(`/projects/${project.id}`, { method: 'DELETE' }); if (projectId === project.id) setProjectId(null); await refresh(); })}>×</button></div>)}
        {!projects.length && <p className="hint">Save a session to pick up where you left off.</p>}
      </div>
      <div className="sidebar-footer"><span className={`status-dot ${connected ? 'online' : ''}`}/><span>{connected ? 'Container API connected' : 'Connecting to API…'}</span><p>C++ inside. Sound everywhere.</p><a href="https://github.com/Triplejw/PulseMix" target="_blank" rel="noreferrer">View the source ↗</a></div>
    </aside>

    <main onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void upload(file); }}>
      {dragging && <div className="drop-overlay"><strong>Drop your next sound.</strong><span>WAV / FLAC · mono or stereo</span></div>}
      <input ref={fileInput} data-testid="audio-upload" type="file" accept=".wav,.flac,audio/wav,audio/flac" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }}/>
      <header className="topbar"><div><span className="eyebrow">WORKSPACE / STEREO LABORATORY</span><h1>Shape your sound<span className="brand-dot">.</span></h1></div><div className="header-actions"><span className="engine-badge"><i/> C++ × WebAssembly</span><button className="primary" disabled={!ready || !!busy} onClick={() => void exportAudio()}>Export WAV ↗</button></div></header>
      <div className="feedback" aria-live="polite">{error && <div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}{busy && <div className="notice busy"><i/>{busy}</div>}{notice && !busy && <div className="notice">✓ {notice}</div>}</div>

      <section className="panel player-panel">
        <div className="player-heading"><div><span className="eyebrow">NOW ON THE BENCH</span><h2>{asset?.name || 'A little space. A lot of possibility.'}</h2><p>{asset ? `${asset.channels === 1 ? 'Mono → stereo' : 'Stereo'} · ${(asset.sample_rate / 1000).toFixed(1)} kHz · ${time(asset.duration)} · Source peak ${db(Math.max(...asset.peak)).toFixed(1)} dBFS` : 'Import a track, or explore with our generated stereo demo.'}</p></div><button disabled={!!busy} onClick={() => void upload(demoFile())}>Try demo ↗</button></div>
        <Waveform asset={asset} position={position} loop={loop} onSeek={(value) => { if (ready) engine.seek(value); }}/>
        <input aria-label="Seek position" className="seek-slider" type="range" min="0" max={asset?.duration || 1} step="0.01" value={position} disabled={!ready || !!busy} onChange={(event) => engine.seek(Number(event.target.value))}/>
        <div className="transport"><div className="transport-buttons"><button className="icon-button" aria-label="Restart" disabled={!ready || !!busy} onClick={() => engine.seek(loop.enabled ? loop.start : 0)}>↤</button><button className="play-button" aria-label={playing ? 'Pause' : 'Play'} disabled={!ready || !!busy} onClick={() => void togglePlayback()}>{playing ? 'Ⅱ' : '▶'}</button><button className={`icon-button ${loop.enabled ? 'active' : ''}`} aria-label="Toggle loop" aria-pressed={loop.enabled} disabled={!ready || loop.end - loop.start < 0.05 || !!busy} onClick={() => setLoop({ ...loop, enabled: !loop.enabled })}>↻</button><span className="timecode">{time(position)} <small>/ {time(asset?.duration || 0)}</small></span></div><span className="keyboard-hint"><kbd>SPACE</kbd> play / pause</span></div>
        {asset && <div className="loop-controls"><span className="eyebrow">LOOP REGION</span><label>In <input aria-label="Loop start" type="number" min="0" max={loop.end} step="0.01" value={Number(loop.start.toFixed(2))} onChange={(event) => setLoop({ ...loop, start: Math.max(0, Math.min(loop.end - 0.05, Number(event.target.value))) })}/></label><button onClick={() => setLoop({ ...loop, start: Math.max(0, Math.min(position, loop.end - 0.05)) })}>Set at playhead</button><label>Out <input aria-label="Loop end" type="number" min={loop.start + 0.05} max={asset.duration} step="0.01" value={Number(loop.end.toFixed(2))} onChange={(event) => setLoop({ ...loop, end: Math.min(asset.duration, Math.max(loop.start + 0.05, Number(event.target.value))) })}/></label><button onClick={() => setLoop({ ...loop, end: Math.min(asset.duration, Math.max(position, loop.start + 0.05)) })}>Set at playhead</button></div>}
      </section>

      <div className="chain-toolbar"><div className="chain-label"><span className="status-dot online"/> SIGNAL CHAIN <span>Stereo → EQ → Gain → Peak guard</span></div><div className="chain-actions"><button className={parameters.bypass ? 'active' : ''} aria-pressed={parameters.bypass} onClick={() => setParameters({ ...parameters, bypass: !parameters.bypass })}>Bypass <kbd>B</kbd></button><button onClick={switchCompare} title="Swap between the current settings and the other snapshot">A / B <strong>{compare}</strong></button><button onClick={() => setParameters({ ...neutral })}>Reset</button></div></div>
      <ProcessingControls parameters={parameters} onChange={setParameters} sampleRate={engine.context?.sampleRate || 48000}/>
      <Visualizers engine={engine}/>

      <section className="panel session-panel"><div><span className="eyebrow">MAKE IT YOURS</span><h2>Presets & sessions</h2></div><div className="session-grid">
        <div><label className="field-label" htmlFor="preset-select">Load a preset</label><select id="preset-select" aria-label="Load preset" defaultValue="" onChange={(event) => { const preset = presets.find((p) => p.id === event.target.value); if (preset) setParameters({ ...preset.parameters }); event.target.value = ''; }}><option value="" disabled>Choose a starting point…</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}{preset.builtin ? '' : ' · custom'}</option>)}</select>
          <div className="inline-form"><input aria-label="Preset name" maxLength={80} value={presetName} onChange={(event) => setPresetName(event.target.value)}/><button disabled={!!busy || !presetName.trim()} onClick={() => void perform('Saving preset…', async () => { await request('/presets', json('POST', { name: presetName.trim(), parameters })); await refresh(); setNotice('Preset saved.'); })}>Save preset</button></div>
          {presets.filter((p) => !p.builtin).map((preset) => <div className="custom-preset" key={preset.id}><span>{preset.name}</span><button aria-label={`Delete preset ${preset.name}`} disabled={!!busy} onClick={() => void perform('Removing preset…', async () => { await request(`/presets/${preset.id}`, { method: 'DELETE' }); await refresh(); })}>×</button></div>)}
        </div><div><label className="field-label" htmlFor="project-name">Session name</label><input id="project-name" maxLength={80} value={projectName} onChange={(event) => setProjectName(event.target.value)}/><div className="inline-form"><button className="primary" disabled={!ready || !!busy} onClick={() => void saveProject()}>Save session</button><button disabled={!ready || !!busy} onClick={() => void saveProject(true)}>Save as new</button></div><p className="hint">Audio, settings, and loop points persist in your Docker volume.</p></div>
      </div></section>
      <footer className="main-footer"><span>BUILT FOR CURIOUS EARS.</span><span>PulseMix 2.0 · Native export / browser playback</span></footer>
    </main>
  </div>;
}
