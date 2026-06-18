// ============================================================
// SOUND.JS — Синтез звуку двигуна через Web Audio API
// Архітектура: 4 шари + exhaust crack + turbo whine
// Без аудіо-файлів. Повністю процедурний.
// ============================================================

class EngineSound {
  constructor() {
    this.ctx       = null;
    this.running   = false;
    this._nodes    = {};
    this._rpm      = 0;
    this._cylinders = 4;
    this._throttle  = 0;
    this._boost     = 0;
    this._knock     = false;
    this._sparkCut  = false;
    this._turboType = 'na';
    this._knockTimer = 0;
  }

  // ──────────────────────────────────────────────────────────
  // INIT — будує весь граф вузлів
  // ──────────────────────────────────────────────────────────
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = this.ctx;

    // Master limiter → out
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6;
    lim.knee.value       = 3;
    lim.ratio.value      = 12;
    lim.attack.value     = 0.001;
    lim.release.value    = 0.05;
    lim.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(lim);
    this._nodes.master = master;

    this._buildEngineBody(ctx, master);
    this._buildExhaust(ctx, master);
    this._buildTurbo(ctx, master);
    this._buildIntake(ctx, master);
  }

  // ──────────────────────────────────────────────────────────
  // ENGINE BODY — механічний стукіт + горіння
  // Шар 1: sub-bass thump (fundamental firing freq)
  // Шар 2: mid punch (2nd harmonic)
  // Шар 3: high mechanical rattle
  // Шар 4: noise burst (combustion crack)
  // ──────────────────────────────────────────────────────────
  _buildEngineBody(ctx, out) {
    const n = this._nodes;

    // Gain для всього тіла
    n.bodyGain = ctx.createGain();
    n.bodyGain.gain.value = 0;
    n.bodyGain.connect(out);

    // ── ШАР 1: sub-bass thump ──────────────────────────────
    // Саундшейп — нерівна хвиля що нагадує вибухи в циліндрах
    // Велика частота = firing freq = RPM/60/2 × N_cyl
    n.sub = ctx.createOscillator();
    n.sub.type = 'sawtooth';
    n.sub.frequency.value = 40;

    n.subFilter = ctx.createBiquadFilter();
    n.subFilter.type = 'lowpass';
    n.subFilter.frequency.value = 120;
    n.subFilter.Q.value = 3;

    // WaveShaper для asymmetric clipping — звучить як compression ignition
    const clipCurve = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      const x = (i * 2) / 512 - 1;
      // Asymmetric: compression stroke harder than expansion
      clipCurve[i] = x > 0
        ? Math.tanh(x * 4) * 0.8
        : Math.tanh(x * 2) * 0.5;
    }
    n.subClip = ctx.createWaveShaper();
    n.subClip.curve = clipCurve;
    n.subClip.oversample = '4x';

    n.subGain = ctx.createGain();
    n.subGain.gain.value = 0.55;

    n.sub.connect(n.subFilter);
    n.subFilter.connect(n.subClip);
    n.subClip.connect(n.subGain);
    n.subGain.connect(n.bodyGain);
    n.sub.start();

    // ── ШАР 2: mid punch (2× firing freq) ─────────────────
    n.mid = ctx.createOscillator();
    n.mid.type = 'square';
    n.mid.frequency.value = 80;

    n.midFilter = ctx.createBiquadFilter();
    n.midFilter.type = 'bandpass';
    n.midFilter.frequency.value = 200;
    n.midFilter.Q.value = 1.5;

    n.midGain = ctx.createGain();
    n.midGain.gain.value = 0.22;

    n.mid.connect(n.midFilter);
    n.midFilter.connect(n.midGain);
    n.midGain.connect(n.bodyGain);
    n.mid.start();

    // ── ШАР 3: high rattle (4× firing freq) ───────────────
    n.high = ctx.createOscillator();
    n.high.type = 'sawtooth';
    n.high.frequency.value = 160;

    n.highFilter = ctx.createBiquadFilter();
    n.highFilter.type = 'bandpass';
    n.highFilter.frequency.value = 600;
    n.highFilter.Q.value = 2;

    n.highGain = ctx.createGain();
    n.highGain.gain.value = 0.08;

    n.high.connect(n.highFilter);
    n.highFilter.connect(n.highGain);
    n.highGain.connect(n.bodyGain);
    n.high.start();

    // ── ШАР 4: noise burst (combustion texture) ────────────
    const nBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd   = nBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    n.noiseSrc = ctx.createBufferSource();
    n.noiseSrc.buffer = nBuf;
    n.noiseSrc.loop = true;

    // Ringmod-like: multiply noise × sub oscillator для характерного "chug"
    n.noiseBp = ctx.createBiquadFilter();
    n.noiseBp.type = 'bandpass';
    n.noiseBp.frequency.value = 400;
    n.noiseBp.Q.value = 4;

    n.noiseGain = ctx.createGain();
    n.noiseGain.gain.value = 0.04;

    n.noiseSrc.connect(n.noiseBp);
    n.noiseBp.connect(n.noiseGain);
    n.noiseGain.connect(n.bodyGain);
    n.noiseSrc.start();
  }

  // ──────────────────────────────────────────────────────────
  // EXHAUST — глибоке бурмотіння + exhaust crack при газовці
  // ──────────────────────────────────────────────────────────
  _buildExhaust(ctx, out) {
    const n = this._nodes;

    n.exhGain = ctx.createGain();
    n.exhGain.gain.value = 0;
    n.exhGain.connect(out);

    // Основне бурмотіння — дуже низький саундscаpe
    const eBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const ed   = eBuf.getChannelData(0);
    // Рожевий шум (краще ніж білий — звучить товстіше)
    let b0=0, b1=0, b2=0;
    for (let i = 0; i < ed.length; i++) {
      const wh = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + wh*0.0555179;
      b1 = 0.99332*b1 + wh*0.0750759;
      b2 = 0.96900*b2 + wh*0.1538520;
      ed[i] = (b0 + b1 + b2 + wh*0.5362) * 0.18;
    }

    n.exhSrc = ctx.createBufferSource();
    n.exhSrc.buffer = eBuf;
    n.exhSrc.loop = true;

    // Два послідовних LP фільтри для дуже глибокого гуркоту
    n.exhLp1 = ctx.createBiquadFilter();
    n.exhLp1.type = 'lowpass';
    n.exhLp1.frequency.value = 200;
    n.exhLp1.Q.value = 2;

    n.exhLp2 = ctx.createBiquadFilter();
    n.exhLp2.type = 'lowpass';
    n.exhLp2.frequency.value = 150;
    n.exhLp2.Q.value = 1;

    // Resonant peak на частоті вихлопної труби (~80-120Гц)
    n.exhPeak = ctx.createBiquadFilter();
    n.exhPeak.type = 'peaking';
    n.exhPeak.frequency.value = 95;
    n.exhPeak.Q.value = 5;
    n.exhPeak.gain.value = 14; // dB boost

    n.exhSrc.connect(n.exhLp1);
    n.exhLp1.connect(n.exhLp2);
    n.exhLp2.connect(n.exhPeak);
    n.exhPeak.connect(n.exhGain);
    n.exhSrc.start();

    // Exhaust CRACK — різкий клацаючий звук при газовці/відсічці
    // Короткий burst noise через HP фільтр
    n.crackGain = ctx.createGain();
    n.crackGain.gain.value = 0;
    n.crackGain.connect(out);

    const cBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const cd   = cBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = Math.random() * 2 - 1;

    n.crackSrc = ctx.createBufferSource();
    n.crackSrc.buffer = cBuf;
    n.crackSrc.loop = true;

    n.crackHp = ctx.createBiquadFilter();
    n.crackHp.type = 'highpass';
    n.crackHp.frequency.value = 1800;
    n.crackHp.Q.value = 1;

    n.crackBp = ctx.createBiquadFilter();
    n.crackBp.type = 'bandpass';
    n.crackBp.frequency.value = 3500;
    n.crackBp.Q.value = 3;

    // Waveshaper для хрускоту
    const crCurve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      crCurve[i] = Math.sign(x) * Math.pow(Math.abs(x), 0.3);
    }
    n.crackShape = ctx.createWaveShaper();
    n.crackShape.curve = crCurve;

    n.crackSrc.connect(n.crackHp);
    n.crackHp.connect(n.crackBp);
    n.crackBp.connect(n.crackShape);
    n.crackShape.connect(n.crackGain);
    n.crackSrc.start();
  }

  // ──────────────────────────────────────────────────────────
  // TURBO — свист турбіни + wastegate
  // ──────────────────────────────────────────────────────────
  _buildTurbo(ctx, out) {
    const n = this._nodes;

    n.turboGain = ctx.createGain();
    n.turboGain.gain.value = 0;
    n.turboGain.connect(out);

    // Turbo whine — синусоїда на ~9-16кГц
    n.turboOsc = ctx.createOscillator();
    n.turboOsc.type = 'sine';
    n.turboOsc.frequency.value = 9000;

    // Другий обертон (турбіна — не ідеальний синус)
    n.turboOsc2 = ctx.createOscillator();
    n.turboOsc2.type = 'sine';
    n.turboOsc2.frequency.value = 18000;

    n.turboMix = ctx.createGain();
    n.turboMix.gain.value = 1;

    n.turboOsc2gain = ctx.createGain();
    n.turboOsc2gain.gain.value = 0.3;

    n.turboOsc.connect(n.turboMix);
    n.turboOsc2.connect(n.turboOsc2gain);
    n.turboOsc2gain.connect(n.turboMix);
    n.turboMix.connect(n.turboGain);

    n.turboOsc.start();
    n.turboOsc2.start();

    // Wastegate flutter (псевт-пс-псс при скиданні тиску)
    n.wgGain = ctx.createGain();
    n.wgGain.gain.value = 0;
    n.wgGain.connect(out);

    const wBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const wd   = wBuf.getChannelData(0);
    // Модульований шум — звук флатеру лопаток
    for (let i = 0; i < wd.length; i++) {
      const t = i / ctx.sampleRate;
      wd[i] = (Math.random() * 2 - 1) * Math.abs(Math.sin(t * 180));
    }
    n.wgSrc = ctx.createBufferSource();
    n.wgSrc.buffer = wBuf;
    n.wgSrc.loop = true;

    n.wgBp = ctx.createBiquadFilter();
    n.wgBp.type = 'bandpass';
    n.wgBp.frequency.value = 2800;
    n.wgBp.Q.value = 3;

    n.wgSrc.connect(n.wgBp);
    n.wgBp.connect(n.wgGain);
    n.wgSrc.start();
  }

  // ──────────────────────────────────────────────────────────
  // INTAKE — всмоктування повітря
  // ──────────────────────────────────────────────────────────
  _buildIntake(ctx, out) {
    const n = this._nodes;

    n.intGain = ctx.createGain();
    n.intGain.gain.value = 0;
    n.intGain.connect(out);

    const iBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const id2  = iBuf.getChannelData(0);
    for (let i = 0; i < id2.length; i++) id2[i] = Math.random() * 2 - 1;

    n.intSrc = ctx.createBufferSource();
    n.intSrc.buffer = iBuf;
    n.intSrc.loop = true;

    n.intBp = ctx.createBiquadFilter();
    n.intBp.type = 'bandpass';
    n.intBp.frequency.value = 600;
    n.intBp.Q.value = 1.8;

    n.intSrc.connect(n.intBp);
    n.intBp.connect(n.intGain);
    n.intSrc.start();
  }

  // ──────────────────────────────────────────────────────────
  // UPDATE — викликається кожен кадр з physics state
  // ──────────────────────────────────────────────────────────
  update(physState) {
    if (!this.ctx) return;
    const ctx  = this.ctx;
    const now  = ctx.currentTime;
    const n    = this._nodes;
    const RAMP = 0.04; // час згладжування (сек)

    const rpm       = Math.max(0, physState.rpm);
    const running   = physState.running;
    const throttle  = physState.throttle;
    const boost     = physState.boost;
    const cylinders = Math.max(1, physState.cylinders);
    const sparkCut  = physState.sparkCutActive;
    const turboType = physState.turboType;

    // Базова частота пострілів (firing frequency):
    // кожен циліндр стріляє RPM/60/2 разів на секунду (4-такт)
    // разом: firingFreq = RPM × N / 120
    const firingHz   = Math.max(8, rpm * cylinders / 120);
    const rpmNorm    = Math.min(1, rpm / 7000); // 0..1

    // RPM-based throttle volume (менше обертів = тихіше + більш глухо)
    const engineVol  = running
      ? 0.7 * Math.min(1, rpm / 600) * (0.3 + 0.7 * rpmNorm)
      : 0;

    // ── Engine body ──────────────────────────────────────
    n.bodyGain.gain.setTargetAtTime(engineVol * (sparkCut ? 0 : 1), now, RAMP);

    // Частоти осциляторів = firingHz і гармоніки
    n.sub.frequency.setTargetAtTime(firingHz, now, RAMP * 0.5);
    n.mid.frequency.setTargetAtTime(firingHz * 2, now, RAMP * 0.5);
    n.high.frequency.setTargetAtTime(firingHz * 4, now, RAMP * 0.5);

    // Динамічний LP для sub: вищі оберти = більше середини
    n.subFilter.frequency.setTargetAtTime(
      Math.min(400, 80 + firingHz * 2.5), now, RAMP);

    // Mid bandpass центр: піднімається з обертами
    n.midFilter.frequency.setTargetAtTime(
      Math.min(1200, 150 + firingHz * 4), now, RAMP);

    // Noise burst частота
    n.noiseBp.frequency.setTargetAtTime(
      Math.min(3000, firingHz * 12), now, RAMP);

    // Gайни шарів: на середніх обертах більше "punch"
    const midVol  = 0.22 * (0.5 + 0.5 * rpmNorm);
    const highVol = 0.05 + 0.08 * rpmNorm;
    const noiseVol= running ? 0.025 + 0.04 * throttle : 0;
    n.subGain.gain.setTargetAtTime(0.55, now, RAMP);
    n.midGain.gain.setTargetAtTime(midVol, now, RAMP);
    n.highGain.gain.setTargetAtTime(highVol, now, RAMP);
    n.noiseGain.gain.setTargetAtTime(noiseVol, now, RAMP);

    // ── Exhaust ──────────────────────────────────────────
    // Глибше бурмотіння при відпусканні газу після високих обертів
    const exhVol = running
      ? 0.5 * Math.min(1, rpm / 500) * (0.5 + 0.5 * rpmNorm)
      : 0;
    n.exhGain.gain.setTargetAtTime(exhVol, now, RAMP);
    n.exhLp1.frequency.setTargetAtTime(
      Math.min(300, 100 + rpm * 0.02), now, RAMP);
    n.exhPeak.frequency.setTargetAtTime(
      Math.min(160, 60 + rpm * 0.012), now, RAMP);

    // Exhaust CRACK: при різкому газу і на відсічці
    const prevThrottle = this._prevThrottle || 0;
    const throttleDelta = throttle - prevThrottle;
    const isCracking = physState.crackEnabled && running && (
      sparkCut ||                              // відсічка іскри
      (throttleDelta > 0.08 && rpm > 1500) ||  // різкий газ
      (throttleDelta < -0.1 && rpm > 2000)     // різке скидання газу
    );
    const crackVol = isCracking ? 0.35 * Math.min(1, rpm / 3000) : 0;
    n.crackGain.gain.setTargetAtTime(crackVol, now, 0.01);
    n.crackHp.frequency.setTargetAtTime(
      1200 + rpm * 0.15, now, RAMP);
    this._prevThrottle = throttle;

    // ── Turbo / supercharger ─────────────────────────────
    const hasBoost = physState.turboSndEnabled && boost > 0.05 && turboType !== 'na';
    if (hasBoost) {
      const turboFreq = 8000 + rpmNorm * 10000; // 8kHz-18kHz
      n.turboOsc.frequency.setTargetAtTime(turboFreq, now, 0.2);
      n.turboOsc2.frequency.setTargetAtTime(turboFreq * 2.1, now, 0.2);
      const turboVol = Math.min(0.3, boost * 0.12) * rpmNorm;
      n.turboGain.gain.setTargetAtTime(turboVol, now, 0.3);

      // Wastegate при скиданні газу після буста
      const wgOpen = throttle < 0.08 && rpm > 2500 && boost > 0.3;
      n.wgGain.gain.setTargetAtTime(wgOpen ? 0.4 : 0, now, 0.03);
    } else {
      n.turboGain.gain.setTargetAtTime(0, now, 0.3);
      n.wgGain.gain.setTargetAtTime(0, now, 0.1);
    }

    // ── Intake whoosh ────────────────────────────────────
    const intVol = running ? 0.12 * throttle * rpmNorm : 0;
    n.intGain.gain.setTargetAtTime(intVol, now, RAMP);
    n.intBp.frequency.setTargetAtTime(
      400 + rpm * 0.08, now, RAMP);

    // ── Knock tick ───────────────────────────────────────
    if (physState.knock && running) {
      this._knockTimer--;
      if (this._knockTimer <= 0) {
        this._knockTimer = 2 + Math.floor(Math.random() * 4);
        this._playKnockTick();
      }
    }

    this._rpm = rpm;
  }

  _playKnockTick() {
    const ctx = this.ctx;
    if (!ctx) return;

    const g = ctx.createGain();
    g.gain.value = 0.5;
    g.connect(this._nodes.master);

    const len = Math.floor(ctx.sampleRate * 0.04);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.3));
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + Math.random() * 800;
    bp.Q.value = 6;

    src.connect(bp);
    bp.connect(g);
    src.start();

    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
  }

  playStarter() {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const g = ctx.createGain();
    g.gain.value = 0.4;
    g.connect(this._nodes.master);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(55, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(140, ctx.currentTime + 0.5);
    osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.9);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;

    osc.connect(lp);
    lp.connect(g);
    osc.start();
    osc.stop(ctx.currentTime + 1.1);

    g.gain.setValueAtTime(0.4, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.0);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  destroy() {
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}

window.EngineSound = EngineSound;
