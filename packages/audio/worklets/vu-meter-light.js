// Lightweight VU meter for single channel (mono)
class VUMeterLight extends AudioWorkletProcessor {
    constructor() {
        super();
        this._env = 0;
        this._samplesSincePost = 0;
        this._samplesPerUpdate = sampleRate / 30; // 30 Hz cap for widget
        this._attack = 0.2;
        this._release = 0.8;
        // Last posted level as a 0-100 integer; -1 forces the first post. The consumer
        // rounds the level anyway, so a sub-integer change is never visible — posting only
        // on an integer change makes a silent input cost no messages.
        this._lastPosted = -1;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        // Mix all channels to mono
        const channels = input.length;
        let peak = 0;

        for (let ch = 0; ch < channels; ch++) {
            const samples = input[ch];
            for (let i = 0; i < samples.length; i++) {
                const v = samples[i];
                const a = v < 0 ? -v : v;
                if (a > peak) peak = a;
            }
        }

        // Envelope follower
        this._env = this._env * this._release + peak * this._attack;

        this._samplesSincePost += input[0].length;

        // Rate-capped, and only when the rounded level actually moved
        if (this._samplesSincePost >= this._samplesPerUpdate) {
            this._samplesSincePost -= this._samplesPerUpdate;
            const level = Math.round(Math.min(1, this._env) * 100);
            if (level !== this._lastPosted) {
                this._lastPosted = level;
                this.port.postMessage(this._env);
            }
        }

        return true;
    }
}

registerProcessor("vu-meter-light", VUMeterLight);
