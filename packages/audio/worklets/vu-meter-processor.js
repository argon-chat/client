class VUMeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this._vu = new Float32Array(2); // [L, R]

        this._envL = 0;
        this._envR = 0;

        this._samplesSincePost = 0;
        this._samplesPerUpdate = sampleRate / 60; // ~60 Hz

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

            this._vu[0] = this._envL;
            this._vu[1] = this._envR;

            this.port.postMessage(this._vu, [this._vu.buffer]);

            this._vu = new Float32Array(2);
        }

        return true;
    }
}

registerProcessor("vu-meter-processor", VUMeterProcessor);
