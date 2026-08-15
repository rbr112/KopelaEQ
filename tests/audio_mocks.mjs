export class Param { constructor(v=0,min=-Infinity,max=Infinity){ this.value=v; this.minValue=min; this.maxValue=max; } cancelScheduledValues(){} setTargetAtTime(v){ this.value=v; } }
export class NodeMock {
  constructor(kind='node'){ this.kind=kind; this.connections=[]; }
  connect(dest, output=0, input=0){ this.connections.push({dest,output,input}); return dest; }
  disconnect(dest){ if(!dest) this.connections=[]; else this.connections=this.connections.filter(c=>c.dest!==dest); }
}
export class GainMock extends NodeMock { constructor(){ super('gain'); this.gain=new Param(1); } }
export class BiquadMock extends NodeMock { constructor(){ super('biquad'); this.type='peaking'; this.frequency=new Param(350,0,24000); this.Q=new Param(1,0.0001,1000); this.gain=new Param(0,-40,40); } }
export class CompressorMock extends NodeMock { constructor(){ super('compressor'); this.threshold=new Param(-24,-100,0); this.knee=new Param(30,0,40); this.ratio=new Param(12,1,20); this.attack=new Param(.003,0,1); this.release=new Param(.25,0,1); this.reduction=0; } }
export class DelayMock extends NodeMock { constructor(){ super('delay'); this.delayTime=new Param(0,0,2.1); } }
export class PannerMock extends NodeMock { constructor(){ super('panner'); this.pan=new Param(0,-1,1); } }
export class ShaperMock extends NodeMock { constructor(){ super('waveshaper'); this.curve=null; this.oversample='none'; } }
export class ConvolverMock extends NodeMock { constructor(){ super('convolver'); this.buffer=null; this.normalize=true; } }
export class OscillatorMock extends NodeMock { constructor(){ super('oscillator'); this.frequency=new Param(1); this.type='sine'; this.started=false; this.stopped=false; } start(){this.started=true;} stop(){this.stopped=true;} }
export class AudioBufferMock { constructor(channels,length){ this.length=length; this.data=Array.from({length:channels},()=>new Float32Array(length)); } getChannelData(ch){return this.data[ch];} }
let analyserIndex=0;
export class AnalyserMock extends NodeMock {
  constructor(){ super('analyser'); this.index=analyserIndex++; this._fft=2048; this.frequencyBinCount=1024; this.minDecibels=-100; this.maxDecibels=-12; this.smoothingTimeConstant=.72; }
  set fftSize(v){this._fft=v;this.frequencyBinCount=v/2;} get fftSize(){return this._fft;}
  getFloatTimeDomainData(a){a.fill(this.index%2===0?.1:.2);} getFloatFrequencyData(a){a.fill(-60);}
}
export class ContextMock {
  constructor(){ this.state='running'; this.currentTime=0; this.sampleRate=48000; this.destination=new NodeMock('destination'); this.listeners=new Map(); this.biquads=[]; this.gains=[]; this.compressors=[]; this.sources=[]; this.analysers=[]; this.oscillators=[]; }
  createMediaStreamSource(){const n=new NodeMock('source');this.sources.push(n);return n;}
  createGain(){const n=new GainMock();this.gains.push(n);return n;}
  createBiquadFilter(){const n=new BiquadMock();this.biquads.push(n);return n;}
  createDynamicsCompressor(){const n=new CompressorMock();this.compressors.push(n);return n;}
  createAnalyser(){const n=new AnalyserMock();this.analysers.push(n);return n;}
  createChannelSplitter(){return new NodeMock('splitter');}
  createChannelMerger(){return new NodeMock('merger');}
  createConvolver(){return new ConvolverMock();}
  createBuffer(channels,length){return new AudioBufferMock(channels,length);}
  createDelay(){return new DelayMock();}
  createStereoPanner(){return new PannerMock();}
  createWaveShaper(){return new ShaperMock();}
  createOscillator(){const n=new OscillatorMock();this.oscillators.push(n);return n;}
  addEventListener(type,fn){const a=this.listeners.get(type)||[];a.push(fn);this.listeners.set(type,a);}
  emit(type){for(const fn of this.listeners.get(type)||[])fn();}
  async resume(){this.state='running';this.emit('statechange');}
  async suspend(){this.state='suspended';this.emit('statechange');}
}
