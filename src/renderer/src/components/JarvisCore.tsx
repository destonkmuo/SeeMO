import { useEffect, useRef, useState } from 'react'
import { JARVIS_WGSL } from '../shaders/jarvis'

interface JarvisCoreProps {
  speaking: boolean
}

const UNIFORM_SIZE = 24

function JarvisCore({ speaking }: JarvisCoreProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const speakingRef = useRef(speaking)
  const [unsupported, setUnsupported] = useState(() => !('gpu' in navigator))

  useEffect(() => {
    speakingRef.current = speaking
  }, [speaking])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || unsupported) return

    let disposed = false
    let frameId = 0
    let device: GPUDevice | null = null

    const init = async (): Promise<void> => {
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        setUnsupported(true)
        return
      }

      device = await adapter.requestDevice()
      if (disposed) {
        device.destroy()
        return
      }

      const context = canvas.getContext('webgpu')
      if (!context) {
        setUnsupported(true)
        return
      }

      const format = navigator.gpu.getPreferredCanvasFormat()
      context.configure({ device, format, alphaMode: 'opaque' })

      const module = device.createShaderModule({ code: JARVIS_WGSL })

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' }
          }
        ]
      })

      const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: 'vs_main' },
        fragment: {
          module,
          entryPoint: 'fs_main',
          targets: [{ format }]
        },
        primitive: { topology: 'triangle-list' }
      })

      const uniformBuffer = device.createBuffer({
        size: UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })

      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
      })

      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: undefined as unknown as GPUTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ]
      }

      const resize = (): void => {
        const dpr = window.devicePixelRatio || 1
        const width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
        const height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
      }

      resize()
      const resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(canvas)

      let colorMix = 0
      let speakingLevel = 0
      const startTime = performance.now()
      const data = new Float32Array(UNIFORM_SIZE / 4)

      const frame = (): void => {
        if (disposed || !device) return

        const target = speakingRef.current ? 1 : 0
        speakingLevel += (target - speakingLevel) * 0.08

        if (speakingRef.current) {
          colorMix += (1 - colorMix) * 0.04
        }

        const time = (performance.now() - startTime) / 1000
        data[0] = time
        data[1] = 0
        data[2] = canvas.width
        data[3] = canvas.height
        data[4] = speakingLevel
        data[5] = colorMix
        device.queue.writeBuffer(uniformBuffer, 0, data)

        renderPassDescriptor.colorAttachments[0].view = context
          .getCurrentTexture()
          .createView()

        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass(renderPassDescriptor)
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(3)
        pass.end()
        device.queue.submit([encoder.finish()])

        frameId = requestAnimationFrame(frame)
      }

      frame()
    }

    init()

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      device?.destroy()
    }
  }, [])

  if (unsupported) {
    return (
      <div className="jarvis-core jarvis-core--unsupported">
        WebGPU is not supported in this environment.
      </div>
    )
  }

  return <canvas ref={canvasRef} className="jarvis-core" />
}

export default JarvisCore
