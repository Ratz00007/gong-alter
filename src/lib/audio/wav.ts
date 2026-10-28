// VALENCE — Pure PCM WAV Buffer Generator (no external ffmpeg required)
export function createPureWavBuffer(seconds: number, freqHz = 440, sampleRate = 16000): Buffer {
  const numSamples = Math.max(1, Math.floor(seconds * sampleRate))
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i++) {
    const val = Math.round(Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * 8000)
    buf.writeInt16LE(val, 44 + i * 2)
  }
  return buf
}
