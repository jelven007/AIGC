class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mediaStream: MediaStream | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private leftchannel: Float32Array[] = [];
  private recordingLength = 0;
  private sampleRate = 16000;
  private recognition: any = null;
  private recognizedText = '';

  async start() {
    this.leftchannel = [];
    this.recordingLength = 0;
    this.recognizedText = '';

    // 初始化浏览器原生 Web Speech API (如果支持)
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'zh-CN';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;

        this.recognition.onresult = (event: any) => {
          let text = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            text += event.results[i][0].transcript;
          }
          if (text) {
            this.recognizedText = text;
          }
        };

        this.recognition.onerror = () => {};
        this.recognition.start();
      } catch {
        this.recognition = null;
      }
    }

    // 请求麦克风权限
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 创建 16000Hz AudioContext
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioContextClass({ sampleRate: this.sampleRate });

    this.input = this.audioContext.createMediaStreamSource(this.mediaStream);

    // 创建 ScriptProcessorNode 录制原生 PCM 数据
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const left = e.inputBuffer.getChannelData(0);
      this.leftchannel.push(new Float32Array(left));
      this.recordingLength += left.length;
    };

    this.input.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  getRecognizedText(): string {
    return this.recognizedText;
  }

  async stop(): Promise<{ base64: string; recognizedText: string }> {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
      this.recognition = null;
    }

    if (this.processor && this.input && this.audioContext) {
      this.processor.disconnect();
      this.input.disconnect();
      this.audioContext.close().catch(() => {});
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }

    // 平铺左声道音频采样数据
    const samples = new Float32Array(this.recordingLength);
    let offset = 0;
    for (let i = 0; i < this.leftchannel.length; i++) {
      samples.set(this.leftchannel[i], offset);
      offset += this.leftchannel[i].length;
    }

    // 编码为标准的 WAV 格式 (16kHz 16bit Mono)
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    /* RIFF identifier */
    this.writeString(view, 0, 'RIFF');
    /* file length */
    view.setUint32(4, 36 + samples.length * 2, true);
    /* RIFF type */
    this.writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    this.writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, this.sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, this.sampleRate * 2, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    this.writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * 2, true);

    // 写入 PCM 音频采样数据
    let index = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(index, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      index += 2;
    }

    // 转换 ArrayBuffer 为 Base64 字符串
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return {
      base64,
      recognizedText: this.recognizedText,
    };
  }

  private writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}

export const audioRecorder = new AudioRecorder();

