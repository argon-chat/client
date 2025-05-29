class VUMeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._rmsL = 0;
        this._rmsR = 0;
    }

    process(inputs) {
        const input = inputs[0];

        if (!input || input.length === 0) return true;

        const chL = input[0];
        const chR = input.length > 1 ? input[1] : null;

        const peak = (buf) => {
            let max = 0;
            for (let i = 0; i < buf.length; i++) {
                max = Math.max(max, Math.abs(buf[i]));
            }
            return max;
        };

        const l = peak(chL);
        const r = peak(chR ?? []);

        this._rmsL = this._rmsL * 0.85 + l * 0.15;
        this._rmsR = this._rmsR * 0.85 + r * 0.15;

        this.port.postMessage({
            left: this._rmsL,
            right: this._rmsR
        });

        return true;
    }
}

registerProcessor('vu-meter-processor', VUMeterProcessor);