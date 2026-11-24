// 跨平台手机网页 16kHz 单声道 16-bit PCM WAV 录音器
// 使用 Web Audio API 直接采集并重采样为标准 WAV，兼容 iOS Safari / Android Chrome / 微信浏览器

const TARGET_SAMPLE_RATE = 16000;
const MAX_DURATION_MS = 45000;

function mergeFloat32(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const result = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

function downsampleLinear(samples, srcRate, dstRate) {
  if (srcRate === dstRate) return samples;
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = samples[idx] || 0;
    const s1 = samples[Math.min(idx + 1, samples.length - 1)] || 0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

function encodeWav16k(floatSamples) {
  const numSamples = floatSamples.length;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export class WavRecorder {
  constructor({ onLevel, onTick, onAutoStop } = {}) {
    this.onLevel = onLevel;
    this.onTick = onTick;
    this.onAutoStop = onAutoStop;
    this.stream = null;
    this.ctx = null;
    this.source = null;
    this.processor = null;
    this.gain = null;
    this.chunks = [];
    this.sampleRate = 48000;
    this.startMs = 0;
    this.timerId = null;
    this.recording = false;
  }

  async start() {
    if (this.recording) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("当前浏览器不支持网页麦克风录音，请改用手机系统浏览器（Safari / Chrome）或使用下方输入框。");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    this.sampleRate = this.ctx.sampleRate || 48000;
    this.chunks = [];

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0; // 避免回声啸叫

    this.processor.onaudioprocess = (event) => {
      if (!this.recording) return;
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.chunks.push(copy);

      if (this.onLevel) {
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        this.onLevel(Math.min(1, rms * 6));
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.gain);
    this.gain.connect(this.ctx.destination);

    this.recording = true;
    this.startMs = Date.now();
    this.timerId = window.setInterval(() => {
      const elapsed = Date.now() - this.startMs;
      if (this.onTick) this.onTick(elapsed);
      if (elapsed >= MAX_DURATION_MS && this.onAutoStop) {
        this.onAutoStop();
      }
    }, 200);
  }

  async stop({ cancel = false } = {}) {
    if (!this.recording) return null;
    this.recording = false;

    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    const durationMs = Date.now() - this.startMs;
    const captured = this.chunks;
    const rate = this.sampleRate;
    this.chunks = [];

    try {
      if (this.processor) this.processor.disconnect();
      if (this.source) this.source.disconnect();
      if (this.gain) this.gain.disconnect();
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    } catch {
      // ignore cleanup errors
    } finally {
      this.processor = null;
      this.source = null;
      this.gain = null;
      this.stream = null;
      this.ctx = null;
    }

    if (cancel) return null;
    const merged = mergeFloat32(captured);
    const downsampled = downsampleLinear(merged, rate, TARGET_SAMPLE_RATE);
    const wavBytes = encodeWav16k(downsampled);
    return {
      wavBase64: uint8ToBase64(wavBytes),
      durationMs,
      byteLength: wavBytes.length,
    };
  }
}
