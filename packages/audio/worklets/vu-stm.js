class StereoToMonoProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'enabled',
        defaultValue: 1.0,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: 'k-rate'
      }
    ];
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (input.length === 0) return true;

    const enabled = parameters.enabled;
    const isEnabled = enabled[0] >= 0.5;

    const inputChannel = input[0];
    const outputChannel1 = output[0];
    const outputChannel2 = output[1];

    if (isEnabled) {
      for (let i = 0; i < inputChannel.length; i++) {
        const sample = inputChannel[i];
        outputChannel1[i] = sample;
        outputChannel2[i] = sample;
      }

    }
    else {
      for (let i = 0; i < inputChannel.length; i++) {
        const sample = inputChannel[i];
        outputChannel1[i] = sample;
      }

      for (let i = 0; i < input[1].length; i++) {
        const sample = input[1][i];
        outputChannel2[i] = sample;
      }
    }

    return true;
  }
}

registerProcessor('vu-stereo-to-mono-processor', StereoToMonoProcessor);