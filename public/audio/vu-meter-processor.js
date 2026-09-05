class VUMeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // One buffer for the lifetime of the node. It used to be transferred on every post
        // and re-allocated (60x/s); an 8-byte structured clone is cheaper than a detach +
        // new Float32Array, and the main thread only reads [0]/[1] anyway.
        this._vu = new Float32Array(2); // [L, R]

        this._envL = 0;
        this._envR = 0;

        // Last posted levels as 0-100 integers; -1 forces the first post so a consumer gets
        // a baseline. After that only a visible (integer) change is posted, so a silent
        // input produces no messages at all.
        this._lastL = -1;
        this._lastR = -1;

        this._samplesSincePost = 0;
        this._samplesPerUpdate = sampleRate / 60; // ~60 Hz cap

        this._attack = 0.15;
        this._release = 0.85;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const chL = input[0];
        const chR = input.length > 1 ? input[1] : null;

        let peakL = 0;
        let peakR = 0;

        for (let i = 0; i < chL.length; i++) {
            const v = chL[i];
            const a = v < 0 ? -v : v;
            if (a > peakL) peakL = a;
        }

        if (chR) {
            for (let i = 0; i < chR.length; i++) {
                const v = chR[i];
                const a = v < 0 ? -v : v;
                if (a > peakR) peakR = a;
            }
        }

        this._envL = this._envL * this._release + peakL * this._attack;
        this._envR = this._envR * this._release + peakR * this._attack;

        this._samplesSincePost += chL.length;

        if (this._samplesSincePost >= this._samplesPerUpdate) {
            this._samplesSincePost -= this._samplesPerUpdate;

            const l = Math.round(Math.min(1, this._envL) * 100);
            const r = Math.round(Math.min(1, this._envR) * 100);

            if (l !== this._lastL || r !== this._lastR) {
                this._lastL = l;
                this._lastR = r;

                this._vu[0] = this._envL;
                this._vu[1] = this._envR;

                // No transfer list: the buffer stays owned here and is reused.
                this.port.postMessage(this._vu);
            }
        }

        return true;
    }
}

registerProcessor("vu-meter-processor", VUMeterProcessor);
