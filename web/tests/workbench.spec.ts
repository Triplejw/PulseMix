import { expect, test } from '@playwright/test';

function fixture(frames = 4096) {
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + frames * 4, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(192000, 28);
  buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  const left: number[] = [], right: number[] = [];
  for (let i = 0; i < frames; i++) {
    const l = Math.round(Math.sin(i * 0.13) * 12000), r = Math.round(Math.sin(i * 0.071) * 7000);
    buffer.writeInt16LE(l, 44 + i * 4); buffer.writeInt16LE(r, 46 + i * 4);
    left.push(l / 32768); right.push(r / 32768);
  }
  return { buffer, left, right };
}

test('complete workbench: demo, WASM playback, loop, preset, project restore, export', async ({ page }) => {
  const sessionName = `QA learning session ${Date.now()}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Container API connected')).toBeVisible();
  await page.getByRole('button', { name: 'Try demo ↗' }).click();
  await expect(page.getByRole('button', { name: 'Export WAV ↗' })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.getByLabel('Seek position').inputValue())).toBeGreaterThan(0.1);
  await expect(page.locator('.meter-values b').first()).not.toHaveText('−∞');
  await page.getByLabel('Load preset').selectOption('mono');
  await expect(page.locator('.correlation strong')).toHaveText('1.00');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByLabel('Load preset').selectOption('wide');
  await expect(page.getByRole('slider', { name: 'Stereo width' })).toHaveValue('1.5');
  await page.getByRole('button', { name: 'A / B A' }).click();
  await expect(page.getByRole('slider', { name: 'Stereo width' })).toHaveValue('1');
  await page.getByRole('button', { name: 'A / B B' }).click();
  await expect(page.getByRole('slider', { name: 'Stereo width' })).toHaveValue('1.5');
  await page.getByLabel('Loop start').fill('0.2');
  await page.getByLabel('Loop end').fill('1');
  await page.getByRole('button', { name: 'Toggle loop' }).click();
  await expect(page.getByRole('button', { name: 'Toggle loop' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Session name').fill(sessionName);
  await page.getByRole('button', { name: 'Save session', exact: true }).click();
  await expect(page.getByText('Project saved to your Docker volume.')).toBeVisible();
  const projectResponse = await page.request.get('/api/projects');
  const project = (await projectResponse.json()).find((p) => p.name === sessionName);
  await page.reload();
  await page.getByRole('button', { name: `↗ ${sessionName}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export WAV ↗' })).toBeEnabled();
  await expect(page.getByRole('slider', { name: 'Stereo width' })).toHaveValue('1.5');
  await expect(page.getByLabel('Loop start')).toHaveValue('0.2');
  await expect(page.getByRole('button', { name: 'Toggle loop' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(1400);
  expect(Number(await page.getByLabel('Seek position').inputValue())).toBeLessThan(1.01);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export WAV ↗' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('-pulsemix.wav');
  expect(await download.failure()).toBeNull();
  expect(errors).toEqual([]);
  await page.request.delete(`/api/projects/${project.id}`);
  await page.request.delete(`/api/assets/${project.asset_id}`);
});

test('WASM and native C++ export agree sample-for-sample at the same rate', async ({ page }) => {
  const { buffer, left, right } = fixture();
  const upload = await page.request.post('/api/assets', { multipart: { file: { name: 'parity.wav', mimeType: 'audio/wav', buffer } } });
  expect(upload.status()).toBe(201);
  const asset = await upload.json();
  await page.goto('/');
  const result = await page.evaluate(async ({ assetId, left, right }) => {
    // Import the actual generated WASM glue, not a reimplementation of the DSP.
    const { default: factory } = await import('/dsp.js');
    const module = await factory();
    const p = { master_db: -2, left_db: 1, right_db: -1, balance: 0.15, width: 1.6,
      low_db: 4, mid_db: -3, high_db: 2, bypass: false, limiter: true };
    const handle = module._dsp_create(48000);
    module._dsp_set(handle, p.master_db, p.left_db, p.right_db, p.balance, p.width,
      p.low_db, p.mid_db, p.high_db, Number(p.bypass), Number(p.limiter));
    module._dsp_reset(handle);
    const lptr = module._dsp_left(handle) / 4, rptr = module._dsp_right(handle) / 4;
    const processed: number[] = [];
    for (let start = 0; start < left.length; start += 128) {
      module.HEAPF32.set(left.slice(start, start + 128), lptr);
      module.HEAPF32.set(right.slice(start, start + 128), rptr);
      module._dsp_process(handle, 128);
      for (let i = 0; i < 128; i++) processed.push(module.HEAPF32[lptr + i], module.HEAPF32[rptr + i]);
    }
    module._dsp_destroy(handle);
    const response = await fetch(`/api/assets/${assetId}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
    });
    if (!response.ok) throw new Error('Native export failed');
    const bytes = await response.arrayBuffer(), view = new DataView(bytes);
    let offset = 12;
    while (offset + 8 < bytes.byteLength) {
      const name = String.fromCharCode(...new Uint8Array(bytes, offset, 4));
      const size = view.getUint32(offset + 4, true); offset += 8;
      if (name === 'data') {
        let maximumError = 0;
        for (let i = 0; i < size / 4; i++) maximumError = Math.max(maximumError, Math.abs(view.getFloat32(offset + i * 4, true) - processed[i]));
        return { maximumError, samples: size / 4, expected: processed.length };
      }
      offset += size + size % 2;
    }
    throw new Error('No WAV data');
  }, { assetId: asset.id, left, right });
  expect(result.samples).toBe(result.expected);
  expect(result.maximumError).toBeLessThan(0.00002);
  await page.request.delete(`/api/assets/${asset.id}`);
});

test('invalid uploads fail visibly and the small-screen layout does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('audio-upload').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('broken') });
  await expect(page.getByRole('alert')).toContainText('Audio processing failed');
  await expect(page.getByRole('button', { name: 'Export WAV ↗' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
