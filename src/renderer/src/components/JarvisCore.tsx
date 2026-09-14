import { useEffect, useRef, useState } from 'react'
import { JARVIS_COMPOSITE, JARVIS_COMPUTE, JARVIS_PARTICLE } from '../shaders/jarvis'
import { useAppStore } from '../store/appStore'

const PARTICLE_COUNT = 40000
const PARTICLE_FLOATS = 8
const WORKGROUP_SIZE = 64

const RESOLUTION_CAP = 1600
const HDR_FORMAT: GPUTextureFormat = 'rgba16float'

const SIM_SIZE = 32
const RENDER_SIZE = 96
const COMPOSITE_SIZE = 32

function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2)
  const nf = 1 / (near - far)
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    far * nf,
    -1,
    0,
    0,
    near * far * nf,
    0
  ])
}

function mat4LookAt(
  ex: number,
  ey: number,
  ez: number,
  cx: number,
  cy: number,
  cz: number,
  ux: number,
  uy: number,
  uz: number
): Float32Array {
  let zx = ex - cx
  let zy = ey - cy
  let zz = ez - cz
  const zl = Math.hypot(zx, zy, zz) || 1
  zx /= zl
  zy /= zl
  zz /= zl

  let xx = uy * zz - uz * zy
  let xy = uz * zx - ux * zz
  let xz = ux * zy - uy * zx
  const xl = Math.hypot(xx, xy, xz) || 1
  xx /= xl
  xy /= xl
  xz /= xl

  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx

  return new Float32Array([
    xx,
    yx,
    zx,
    0,
    xy,
    yy,
    zy,
    0,
    xz,
    yz,
    zz,
    0,
    -(xx * ex + xy * ey + xz * ez),
    -(yx * ex + yy * ey + yz * ez),
    -(zx * ex + zy * ey + zz * ez),
    1
  ])
}

function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + r] * b[c * 4 + k]
      }
      out[c * 4 + r] = sum
    }
  }
  return out
}

function buildViewProj(): Float32Array {
  const proj = mat4Perspective((50 * Math.PI) / 180, 1, 0.1, 100)
  const view = mat4LookAt(0, 0.5, 3.0, 0, 0, 0, 0, 1, 0)
  return mat4Mul(proj, view)
}

function buildParticles(): Float32Array<ArrayBuffer> {
  const data = new Float32Array(PARTICLE_COUNT * PARTICLE_FLOATS)
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const o = i * PARTICLE_FLOATS
    const theta = Math.random() * Math.PI * 2
    const cosPhi = Math.random() * 2 - 1
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi))
    const dx = sinPhi * Math.cos(theta)
    const dy = cosPhi
    const dz = sinPhi * Math.sin(theta)
    const r = 0.45 + 0.6 * Math.pow(Math.random(), 0.6)

    let tx = dz
    let tz = -dx
    const tl = Math.hypot(tx, tz) || 1
    tx /= tl
    tz /= tl
    const speed = 0.3 + 0.5 * Math.random()

    data[o] = dx * r
    data[o + 1] = dy * r
    data[o + 2] = dz * r
    data[o + 3] = Math.random()
    data[o + 4] = tx * speed
    data[o + 5] = 0
    data[o + 6] = tz * speed
    data[o + 7] = 1
  }
  return data
}

function JarvisCore(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const speaking = useAppStore((state) => state.speaking)
  const speakingRef = useRef(speaking)
  const [unsupported, setUnsupported] = useState(() => !('gpu' in navigator))

  useEffect(() => {
    speakingRef.current = speaking
  }, [speaking])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !('gpu' in navigator)) return

    let disposed = false
    let frameId = 0
    let device: GPUDevice | null = null
    let resizeObserver: ResizeObserver | null = null

    const init = async (): Promise<void> => {
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        setUnsupported(true)
        return
      }

      const gpu = await adapter.requestDevice()
      device = gpu
      if (disposed) {
        gpu.destroy()
        return
      }

      const context = canvas.getContext('webgpu')
      if (!context) {
        setUnsupported(true)
        return
      }

      const format = navigator.gpu.getPreferredCanvasFormat()
      context.configure({ device: gpu, format, alphaMode: 'opaque' })

      const computeModule = gpu.createShaderModule({ code: JARVIS_COMPUTE })
      const particleModule = gpu.createShaderModule({ code: JARVIS_PARTICLE })
      const compositeModule = gpu.createShaderModule({ code: JARVIS_COMPOSITE })

      for (const [name, mod] of [
        ['compute', computeModule],
        ['particle', particleModule],
        ['composite', compositeModule]
      ] as const) {
        const info = await mod.getCompilationInfo()
        const errors = info.messages.filter((m) => m.type === 'error')
        if (errors.length > 0) {
          console.error(
            `Jarvis ${name} shader failed to compile:\n${errors
              .map((m) => `${m.lineNum}:${m.linePos} ${m.message}`)
              .join('\n')}`
          )
          setUnsupported(true)
          return
        }
      }

      const particleBuffer = gpu.createBuffer({
        size: PARTICLE_COUNT * PARTICLE_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      })
      gpu.queue.writeBuffer(particleBuffer, 0, buildParticles())

      const simBuffer = gpu.createBuffer({
        size: SIM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })
      const renderBuffer = gpu.createBuffer({
        size: RENDER_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })
      const compositeBuffer = gpu.createBuffer({
        size: COMPOSITE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })

      const simLayout = gpu.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'storage' }
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'uniform' }
          }
        ]
      })
      const particleLayout = gpu.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: 'read-only-storage' }
          },
          {
            binding: 1,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' }
          }
        ]
      })
      const compositeLayout = gpu.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' }
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: 'float' }
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: 'filtering' }
          }
        ]
      })

      const computePipeline = gpu.createComputePipeline({
        layout: gpu.createPipelineLayout({ bindGroupLayouts: [simLayout] }),
        compute: { module: computeModule, entryPoint: 'cs_main' }
      })
      const particlePipeline = gpu.createRenderPipeline({
        layout: gpu.createPipelineLayout({ bindGroupLayouts: [particleLayout] }),
        vertex: { module: particleModule, entryPoint: 'vs_particle' },
        fragment: {
          module: particleModule,
          entryPoint: 'fs_particle',
          targets: [
            {
              format: HDR_FORMAT,
              blend: {
                color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
              }
            }
          ]
        },
        primitive: { topology: 'triangle-list' }
      })
      const compositePipeline = gpu.createRenderPipeline({
        layout: gpu.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
        vertex: { module: compositeModule, entryPoint: 'vs_fullscreen' },
        fragment: {
          module: compositeModule,
          entryPoint: 'fs_composite',
          targets: [{ format }]
        },
        primitive: { topology: 'triangle-list' }
      })

      const simBindGroup = gpu.createBindGroup({
        layout: simLayout,
        entries: [
          { binding: 0, resource: { buffer: particleBuffer } },
          { binding: 1, resource: { buffer: simBuffer } }
        ]
      })
      const particleBindGroup = gpu.createBindGroup({
        layout: particleLayout,
        entries: [
          { binding: 0, resource: { buffer: particleBuffer } },
          { binding: 1, resource: { buffer: renderBuffer } }
        ]
      })

      const sampler = gpu.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge'
      })

      let sceneTexture: GPUTexture | null = null
      let sceneSize = 0
      let compositeBindGroup: GPUBindGroup | null = null

      const simData = new Float32Array(SIM_SIZE / 4)
      const renderData = new Float32Array(RENDER_SIZE / 4)
      const compositeData = new Float32Array(COMPOSITE_SIZE / 4)
      const viewProj = buildViewProj()

      const resize = (): void => {
        const dpr = window.devicePixelRatio || 1
        const css = Math.min(canvas.clientWidth, canvas.clientHeight) || 1
        const size = Math.min(Math.max(1, Math.floor(css * dpr)), RESOLUTION_CAP)
        if (canvas.width !== size || canvas.height !== size) {
          canvas.width = size
          canvas.height = size
        }

        if (size !== sceneSize || !sceneTexture) {
          sceneTexture?.destroy()
          sceneTexture = gpu.createTexture({
            size: { width: size, height: size },
            format: HDR_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
          })
          sceneSize = size
          compositeBindGroup = gpu.createBindGroup({
            layout: compositeLayout,
            entries: [
              { binding: 0, resource: { buffer: compositeBuffer } },
              { binding: 1, resource: sceneTexture.createView() },
              { binding: 2, resource: sampler }
            ]
          })
        }
      }

      resize()
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(canvas)

      let colorMix = 0
      let speakingLevel = 0
      let lastTime = performance.now()
      const startTime = lastTime

      const frame = (): void => {
        if (disposed || !sceneTexture || !compositeBindGroup) return

        const now = performance.now()
        const dt = Math.min((now - lastTime) / 1000, 1 / 30)
        lastTime = now
        const time = (now - startTime) / 1000

        const target = speakingRef.current ? 1 : 0
        speakingLevel += (target - speakingLevel) * 0.08
        if (speakingRef.current) {
          colorMix += (1 - colorMix) * 0.04
        }

        simData[0] = dt
        simData[1] = time
        simData[2] = PARTICLE_COUNT
        simData[3] = speakingLevel
        simData[4] = 0.1 + speakingLevel * 0.2
        simData[5] = 0.9 + speakingLevel * 1.8
        gpu.queue.writeBuffer(simBuffer, 0, simData)

        renderData.set(viewProj, 0)
        renderData[16] = canvas.width
        renderData[17] = canvas.height
        renderData[18] = time
        renderData[19] = speakingLevel
        renderData[20] = colorMix
        renderData[21] = 0.016 + speakingLevel * 0.003
        renderData[22] = 0.045 + speakingLevel * 0.035
        gpu.queue.writeBuffer(renderBuffer, 0, renderData)

        compositeData[0] = canvas.width
        compositeData[1] = canvas.height
        compositeData[2] = time
        compositeData[3] = colorMix
        compositeData[4] = speakingLevel
        gpu.queue.writeBuffer(compositeBuffer, 0, compositeData)

        const encoder = gpu.createCommandEncoder()

        const computePass = encoder.beginComputePass()
        computePass.setPipeline(computePipeline)
        computePass.setBindGroup(0, simBindGroup)
        computePass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE))
        computePass.end()

        const scenePass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: sceneTexture.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store'
            }
          ]
        })
        scenePass.setPipeline(particlePipeline)
        scenePass.setBindGroup(0, particleBindGroup)
        scenePass.draw(6, PARTICLE_COUNT)
        scenePass.end()

        const compositePass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store'
            }
          ]
        })
        compositePass.setPipeline(compositePipeline)
        compositePass.setBindGroup(0, compositeBindGroup)
        compositePass.draw(3)
        compositePass.end()

        gpu.queue.submit([encoder.finish()])
        frameId = requestAnimationFrame(frame)
      }

      frame()
    }

    init()

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      resizeObserver?.disconnect()
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
