from playwright.sync_api import sync_playwright

SCRIPT = r'''async () => {
  async function render(withMetering) {
    const sampleRate = 48000;
    const frames = 4096;
    const ctx = new OfflineAudioContext(2, frames, sampleRate);
    const buffer = ctx.createBuffer(2, frames, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < frames; i++) {
        const t = i / sampleRate;
        data[i] = 0.45 * Math.sin(2 * Math.PI * (ch ? 997 : 440) * t)
          + 0.16 * Math.sin(2 * Math.PI * 83 * t);
      }
    }
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const protectionIn = ctx.createGain();
    const dry = ctx.createGain();
    const protectionOut = ctx.createGain();
    source.connect(protectionIn);
    protectionIn.connect(dry);
    dry.connect(protectionOut);
    protectionOut.connect(ctx.destination);

    if (withMetering) {
      const preSplit = ctx.createChannelSplitter(2);
      const preL = ctx.createAnalyser(); const preR = ctx.createAnalyser();
      preL.fftSize = 512; preR.fftSize = 512;
      protectionIn.connect(preSplit);
      preSplit.connect(preL, 0); preSplit.connect(preR, 1);

      const postSplit = ctx.createChannelSplitter(2);
      const postL = ctx.createAnalyser(); const postR = ctx.createAnalyser();
      postL.fftSize = 512; postR.fftSize = 512;
      protectionOut.connect(postSplit);
      postSplit.connect(postL, 0); postSplit.connect(postR, 1);

      const spectrum = ctx.createAnalyser();
      spectrum.fftSize = 8192;
      spectrum.minDecibels = -100;
      spectrum.maxDecibels = 0;
      protectionOut.connect(spectrum);
    }

    source.start();
    const rendered = await ctx.startRendering();
    return [Array.from(rendered.getChannelData(0)), Array.from(rendered.getChannelData(1))];
  }

  const dry = await render(false);
  const metered = await render(true);
  let maxError = 0;
  for (let ch = 0; ch < 2; ch++) {
    for (let i = 0; i < dry[ch].length; i++) {
      maxError = Math.max(maxError, Math.abs(dry[ch][i] - metered[ch][i]));
    }
  }
  return { maxError, frames: dry[0].length };
}'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'])
    page = browser.new_page()
    page.set_content('<!doctype html><html><body></body></html>')
    result = page.evaluate(SCRIPT)
    browser.close()

assert result['maxError'] <= 1e-7, result
print(f"meter_sidechain_browser.py: PASS (max audible-path delta {result['maxError']:.3g}, frames {result['frames']})")
