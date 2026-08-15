from pathlib import Path
from playwright.sync_api import sync_playwright
import re
ROOT=Path(__file__).resolve().parents[1]; JS=ROOT/'extension/js'
def classic(path):
    text=path.read_text()
    text=re.sub(r'^import .*?;\s*$', '', text, flags=re.M)
    return re.sub(r'\bexport\s+(?=(?:const|let|var|class|function)\b)', '', text)
script='\n'.join(classic(JS/p) for p in [
    Path('shared/constants.js'),Path('shared/state.js'),Path('audio/bypass-gate.js'),
    Path('audio/stereo-math.js'),Path('audio/stereo-stage.js'),Path('audio/effect-stages.js')
])
TEST=r'''async () => {
  const sampleRate=48000, frames=8192;
  async function render(kind){
    const ctx=new OfflineAudioContext(2,frames,sampleRate);
    const buffer=ctx.createBuffer(2,frames,sampleRate);
    for(let ch=0;ch<2;ch++){const d=buffer.getChannelData(ch);for(let i=0;i<frames;i++)d[i]=0.33*Math.sin(2*Math.PI*(ch?997:440)*i/sampleRate)+0.11*Math.sin(2*Math.PI*83*i/sampleRate);}
    const src=ctx.createBufferSource();src.buffer=buffer;
    let disposer=()=>{};
    if(kind==='direct') src.connect(ctx.destination);
    else if(kind==='pitch') { const input=ctx.createGain(),dry=ctx.createGain(),wet=ctx.createGain(),out=ctx.createGain(); src.connect(input); input.connect(dry); dry.connect(out); wet.connect(out); out.connect(ctx.destination); disposer=()=>[input,dry,wet,out].forEach(n=>n.disconnect()); }
    else {
      const map={stereo:StereoStage,reverb:ReverbStage,autopan:AutoPanStage};
      const stage=new map[kind](ctx); src.connect(stage.input); stage.output.connect(ctx.destination); disposer=()=>stage.dispose();
    }
    src.start(); const rendered=await ctx.startRendering(); disposer(); return [Array.from(rendered.getChannelData(0)),Array.from(rendered.getChannelData(1))];
  }
  const reference=await render('direct'), result={};
  for(const kind of ['pitch','stereo','reverb','autopan']){
    const actual=await render(kind);let max=0;for(let ch=0;ch<2;ch++)for(let i=0;i<frames;i++)max=Math.max(max,Math.abs(reference[ch][i]-actual[ch][i]));result[kind]=max;
  }
  return result;
}'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'])
    page=browser.new_page();page.set_content(f'<script>{script}</script>'); result=page.evaluate(TEST); browser.close()
for kind,error in result.items(): assert error <= 1e-7,(kind,error)
print('new_stage_dry_path_browser.py: PASS ' + ', '.join(f'{k}={v:.3g}' for k,v in result.items()))
