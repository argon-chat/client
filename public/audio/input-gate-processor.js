// Input Gate Processor — hard-cuts audio below a configurable dB threshold
// Supports stereo, has hold time to avoid choppy cuts on speech pauses.
class InputGateProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: "threshold", defaultValue: -40, minValue: -100, maxValue: 0, automationRate: "k-rate" },
            { name: "enabled", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
        ];
    }

    constructor() {
        super();
        this._holdSamples = Math.round(sampleRate * 0.15); // 150ms hold
        this._holdCounter = 0;
        this._isOpen = false;
        this._samplesSincePost = 0;
        this._samplesPerUpdate = Math.round(sampleRate / 30); // 30 Hz state updates
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || input.length === 0) return true;

        const enabled = parameters.enabled[0] >= 0.5;

        // If disabled, passthrough
        if (!enabled) {
            for (let ch = 0; ch < input.length; ch++) {
                const inp = input[ch];
                const out = output[ch];
                if (out && inp) {
                    out.set(inp);
                }
            }
            // Report open state when disabled
            this._postState(true);
            return true;
        }

        const thresholdDb = parameters.threshold[0];
        // Convert dB threshold to linear amplitude
        const thresholdLinear = Math.pow(10, thresholdDb / 20);

        // Measure peak across all channels
        let peak = 0;
        for (let ch = 0; ch < input.length; ch++) {
            const samples = input[ch];
            for (let i = 0; i < samples.length; i++) {
                const a = samples[i] < 0 ? -samples[i] : samples[i];
                if (a > peak) peak = a;
            }
        }

        // Gate logic with hold
        if (peak >= thresholdLinear) {
            this._isOpen = true;
            this._holdCounter = this._holdSamples;
        } else if (this._holdCounter > 0) {
            this._holdCounter -= input[0].length;
            // Still open during hold
        } else {
            this._isOpen = false;
        }

        // Apply gate
        if (this._isOpen) {
            for (let ch = 0; ch < input.length; ch++) {
                const inp = input[ch];
                const out = output[ch];
                if (out && inp) {
                    out.set(inp);
                }
            }
        } else {
            // Silence output
            for (let ch = 0; ch < output.length; ch++) {
                const out = output[ch];
                if (out) {
                    out.fill(0);
                }
            }
        }

        // Post gate state at reduced rate
        this._samplesSincePost += input[0].length;
        if (this._samplesSincePost >= this._samplesPerUpdate) {
            this._samplesSincePost -= this._samplesPerUpdate;
            this._postState(this._isOpen);
        }

        return true;
    }

    _postState(isOpen) {
        this.port.postMessage({ isOpen });
    }
}

registerProcessor("input-gate-processor", InputGateProcessor);
