import { useCallback, useEffect, useRef, useState } from 'react'

const SAMPLE_RATE = 16000
const BUFFER_SIZE = 4096

export interface MicDevice {
  deviceId: string
  label: string
}

export interface UseMicrophoneOptions {
  onChunk?: (pcm: Float32Array) => void
  onLevel?: (rms: number) => void
}

export interface UseMicrophone {
  devices: MicDevice[]
  selectedDeviceId: string | null
  setSelectedDeviceId: (id: string) => void
  isRecording: boolean
  isPaused: boolean
  level: number
  /**
   * Live AnalyserNode reference for sound-reactive visualizations.
   * Consumers call `getByteFrequencyData(arr)` in their rAF loop —
   * doing this through state would cause 60 React renders per second.
   * The ref is `null` until `start()` resolves.
   */
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  start: () => Promise<void>
  stop: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  error: string | null
}

export function useMicrophone(opts: UseMicrophoneOptions = {}): UseMicrophone {
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const onChunkRef = useRef(opts.onChunk)
  const onLevelRef = useRef(opts.onLevel)
  onChunkRef.current = opts.onChunk
  onLevelRef.current = opts.onLevel

  const loadDevices = useCallback(async (): Promise<void> => {
    // Enumerate devices without prompting for permission. Labels will be
    // empty until the user grants access, which we defer to the first
    // `start()` call.
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const mics = all
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `입력 장치 ${i + 1}`
        }))
      setDevices(mics)
      setSelectedDeviceId((current) => current ?? mics[0]?.deviceId ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void loadDevices()
    const handler = (): void => void loadDevices()
    navigator.mediaDevices.addEventListener('devicechange', handler)
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler)
  }, [loadDevices])

  const start = useCallback(async (): Promise<void> => {
    setError(null)
    if (isRecording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      })
      // Now that the user granted permission, re-enumerate so labels populate.
      void loadDevices()
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1)
      // FFT analyser for visualization. 256-bin FFT gives 128 frequency
      // bins which is enough resolution for a column-mapped dot grid
      // (we typically have ~60 columns). Smoothing 0.6 = snappy attack
      // with a gentle decay, more responsive than the browser default.
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.6

      processor.onaudioprocess = (e: AudioProcessingEvent): void => {
        const input = e.inputBuffer.getChannelData(0)
        const copy = new Float32Array(input.length)
        copy.set(input)
        onChunkRef.current?.(copy)

        let sumSq = 0
        for (let i = 0; i < copy.length; i++) sumSq += copy[i] * copy[i]
        const rms = Math.sqrt(sumSq / copy.length)
        setLevel(rms)
        onLevelRef.current?.(rms)
      }

      // Tap the source for both the WAV-bound script processor AND the
      // FFT analyser. analyser doesn't need to be in the chain to a
      // destination — it just observes whatever is connected to it.
      source.connect(processor)
      source.connect(analyser)
      processor.connect(ctx.destination)

      streamRef.current = stream
      ctxRef.current = ctx
      sourceRef.current = source
      processorRef.current = processor
      analyserRef.current = analyser
      setIsRecording(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [isRecording, selectedDeviceId, loadDevices])

  const stop = useCallback(async (): Promise<void> => {
    if (!isRecording) return
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    await ctxRef.current?.close()
    processorRef.current = null
    sourceRef.current = null
    streamRef.current = null
    ctxRef.current = null
    analyserRef.current = null
    setIsRecording(false)
    setIsPaused(false)
    setLevel(0)
  }, [isRecording])

  const pause = useCallback(async (): Promise<void> => {
    // Suspend the audio graph so onaudioprocess stops firing — saves CPU
    // and prevents the rolling partial-transcript buffer from drifting
    // while the user is away. Track lifecycle stays open so a quick
    // resume() doesn't have to re-acquire mic permission.
    if (!isRecording || isPaused) return
    await ctxRef.current?.suspend()
    setIsPaused(true)
  }, [isRecording, isPaused])

  const resume = useCallback(async (): Promise<void> => {
    if (!isRecording || !isPaused) return
    await ctxRef.current?.resume()
    setIsPaused(false)
  }, [isRecording, isPaused])

  useEffect(
    () => () => {
      // Cleanup on unmount: synchronously stop tracks and disconnect nodes.
      processorRef.current?.disconnect()
      sourceRef.current?.disconnect()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      ctxRef.current?.close()
    },
    []
  )

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    isRecording,
    isPaused,
    level,
    analyserRef,
    start,
    stop,
    pause,
    resume,
    error
  }
}
