/**
 * A tiny procedural sound design for the tank. Everything is synthesised —
 * no audio files — so the ambience can follow the state of the reef: the low
 * filtered noise of moving water, bubbles when food hits the surface, a soft
 * chime when a fish is fed, a whoosh when an animal inks.
 */

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private drone: OscillatorNode | null = null;
  private started = false;
  private muted = false;
  private lastPop = 0;

  get enabled(): boolean {
    return this.started && !this.muted;
  }

  /** Must be called from a user gesture on most browsers. */
  async start(): Promise<void> {
    if (this.started) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    await ctx.resume().catch(() => undefined);
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.55;
    master.connect(ctx.destination);
    this.master = master;

    // ---- water: brown-ish noise through a slowly sweeping lowpass
    const len = Math.floor(ctx.sampleRate * 4);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.7;
    const ambient = ctx.createGain();
    ambient.gain.value = 0.28;
    src.connect(lp).connect(ambient).connect(master);
    src.start();
    this.noise = src;
    this.ambientGain = ambient;

    // slow LFO on the filter so the water breathes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();

    // ---- deep drone
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 58;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    drone.connect(droneGain).connect(master);
    drone.start();
    this.drone = drone;

    const vib = ctx.createOscillator();
    vib.frequency.value = 0.11;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 1.6;
    vib.connect(vibGain).connect(drone.frequency);
    vib.start();

    this.started = true;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.55, this.ctx.currentTime + 0.25);
    }
  }

  setDepth(depth01: number): void {
    if (!this.ctx || !this.ambientGain) return;
    const t = Math.max(0.08, 0.34 - depth01 * 0.18);
    this.ambientGain.gain.linearRampToValueAtTime(t, this.ctx.currentTime + 1.2);
  }

  /** Small rising bubble — used for food hitting the water. */
  bubble(pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastPop < 0.028) return;
    this.lastPop = now;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = 340 * pitch * (0.85 + Math.random() * 0.4);
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f0 * 2.6, now + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.09, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  /** A satisfied chomp. */
  chomp(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(680 + Math.random() * 220, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.06, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /** Soft bell for a new arrival or a milestone. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;
    [1, 1.5, 2.25].forEach((mult, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 392 * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.045 / (i + 1), now + i * 0.05 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.05 + 0.9);
      osc.connect(g).connect(this.master!);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 1);
    });
  }

  /** Ink / disturbance whoosh. */
  whoosh(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, now);
    bp.frequency.exponentialRampToValueAtTime(160, now + 0.45);
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = 0.07;
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
  }

  dispose(): void {
    this.noise?.stop();
    this.drone?.stop();
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.started = false;
  }
}
