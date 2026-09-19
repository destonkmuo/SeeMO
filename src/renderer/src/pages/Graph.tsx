import { useEffect, useMemo, useRef } from 'react'
import { parseWikiLinks, resolveWikiTarget } from '../notes'
import { useAppStore } from '../store/appStore'

interface GraphNode {
  id: string
  title: string
  /** Raw content length in chars — drives a slight size boost per bubble. */
  size: number
}

interface GraphEdge {
  a: string
  b: string
}

interface Body {
  x: number
  y: number
  vx: number
  vy: number
}

const DEGREE_CAP = 8
const SPRING_LENGTH = 150
const SPRING_K = 0.02
const REPULSION = 4200
const GRAVITY = 0.012
const DAMPING = 0.86
const MAX_VEL = 6
const MIN_ZOOM = 0.3
const MAX_ZOOM = 3
const CLICK_TOLERANCE = 5

/** Bubble color by connectivity: isolated notes stay slate, linked notes go
 * blue, hubs (3+ links) go amber. Hovered/neighbor nodes keep the accent. */
const COLOR_ISOLATED = '#3d4f63'
const COLOR_LINKED = '#3f8fff'
const COLOR_HUB = '#ff9d2e'
const COLOR_HOT = '#6ab0ff'

function colorForDegree(degree: number): string {
  if (degree >= 3) return COLOR_HUB
  if (degree >= 1) return COLOR_LINKED
  return COLOR_ISOLATED
}

/** Slight growth with file size: 0 chars adds nothing, ~1k chars adds ~3px. */
function sizeBoost(size: number): number {
  return Math.min(3, Math.log10(size + 1))
}

function Graph(): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const openNote = useAppStore((state) => state.openNote)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const openNoteRef = useRef(openNote)
  useEffect(() => {
    openNoteRef.current = openNote
  })

  const live = useMemo(() => notes.filter((note) => !note.deletedAt), [notes])

  const { nodes, edges } = useMemo(() => {
    const built: GraphNode[] = live.map((note) => ({
      id: note.id,
      title: note.title.trim() || 'Untitled',
      size: note.content.length
    }))
    const seen = new Set<string>()
    const links: GraphEdge[] = []
    for (const note of live) {
      for (const link of parseWikiLinks(note.content)) {
        const targetId = resolveWikiTarget(link.target, live)
        if (!targetId || targetId === note.id) continue
        const key = [note.id, targetId].sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)
        links.push({ a: note.id, b: targetId })
      }
    }
    return { nodes: built, edges: links }
  }, [live])

  const dataRef = useRef({ nodes, edges })
  useEffect(() => {
    dataRef.current = { nodes, edges }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const sim = {
      pos: new Map<string, Body>(),
      zoom: 1,
      panX: 0,
      panY: 0,
      dragId: null as string | null,
      panning: false,
      moved: false,
      lastX: 0,
      lastY: 0,
      hoverId: null as string | null
    }

    let raf = 0
    let width = 0
    let height = 0
    let disposed = false

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)

    const toWorld = (sx: number, sy: number): { x: number; y: number } => ({
      x: (sx - width / 2 - sim.panX) / sim.zoom,
      y: (sy - height / 2 - sim.panY) / sim.zoom
    })

    const eventPos = (event: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    const hitNode = (sx: number, sy: number): string | null => {
      const { nodes: live } = dataRef.current
      const w = toWorld(sx, sy)
      const tol = 12 / sim.zoom
      let best: string | null = null
      let bestDist = tol
      for (const node of live) {
        const p = sim.pos.get(node.id)
        if (!p) continue
        const d = Math.hypot(p.x - w.x, p.y - w.y)
        if (d < bestDist) {
          bestDist = d
          best = node.id
        }
      }
      return best
    }

    const step = (): void => {
      const { nodes: live, edges: liveEdges } = dataRef.current
      const ids = new Set(live.map((n) => n.id))
      for (const id of sim.pos.keys()) {
        if (!ids.has(id)) sim.pos.delete(id)
      }
      live.forEach((node, i) => {
        if (!sim.pos.has(node.id)) {
          const angle = (i / Math.max(1, live.length)) * Math.PI * 2
          sim.pos.set(node.id, {
            x: Math.cos(angle) * 240,
            y: Math.sin(angle) * 240,
            vx: 0,
            vy: 0
          })
        }
      })

      const adjacency = new Map<string, Set<string>>()
      for (const edge of liveEdges) {
        if (!adjacency.has(edge.a)) adjacency.set(edge.a, new Set())
        if (!adjacency.has(edge.b)) adjacency.set(edge.b, new Set())
        adjacency.get(edge.a)?.add(edge.b)
        adjacency.get(edge.b)?.add(edge.a)
      }

      // Repulsion between every pair.
      for (let i = 0; i < live.length; i++) {
        const a = sim.pos.get(live[i].id)
        if (!a) continue
        for (let j = i + 1; j < live.length; j++) {
          const b = sim.pos.get(live[j].id)
          if (!b) continue
          let dx = a.x - b.x
          let dy = a.y - b.y
          let distSq = dx * dx + dy * dy
          if (distSq < 1) {
            dx = Math.random() - 0.5
            dy = Math.random() - 0.5
            distSq = 1
          }
          const dist = Math.sqrt(distSq)
          const force = Math.min(REPULSION / distSq, 12)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx += fx
          a.vy += fy
          b.vx -= fx
          b.vy -= fy
        }
      }

      // Springs along edges.
      for (const edge of liveEdges) {
        const a = sim.pos.get(edge.a)
        const b = sim.pos.get(edge.b)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy) || 1
        const force = (dist - SPRING_LENGTH) * SPRING_K
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }

      // Gravity + integrate (the dragged node is pinned to the cursor).
      for (const node of live) {
        const p = sim.pos.get(node.id)
        if (!p || node.id === sim.dragId) continue
        p.vx += -p.x * GRAVITY
        p.vy += -p.y * GRAVITY
        p.vx *= DAMPING
        p.vy *= DAMPING
        const speed = Math.hypot(p.vx, p.vy)
        if (speed > MAX_VEL) {
          p.vx = (p.vx / speed) * MAX_VEL
          p.vy = (p.vy / speed) * MAX_VEL
        }
        p.x += p.vx
        p.y += p.vy
      }

      // Draw.
      ctx.clearRect(0, 0, width, height)
      ctx.save()
      ctx.translate(width / 2 + sim.panX, height / 2 + sim.panY)
      ctx.scale(sim.zoom, sim.zoom)

      const hovered = sim.hoverId
      const neighbors = hovered ? (adjacency.get(hovered) ?? new Set<string>()) : null
      const isDimmed = (id: string): boolean =>
        hovered !== null && id !== hovered && !neighbors?.has(id)

      for (const edge of liveEdges) {
        const a = sim.pos.get(edge.a)
        const b = sim.pos.get(edge.b)
        if (!a || !b) continue
        const hot = hovered !== null && (edge.a === hovered || edge.b === hovered)
        ctx.strokeStyle = hot ? '#6ab0ff' : 'rgba(140, 160, 180, 0.28)'
        ctx.lineWidth = hot ? 1.8 / sim.zoom : 1 / sim.zoom
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }

      for (const node of live) {
        const p = sim.pos.get(node.id)
        if (!p) continue
        const links = adjacency.get(node.id)?.size ?? 0
        const degree = Math.min(links, DEGREE_CAP)
        const hot = hovered === node.id || neighbors?.has(node.id) === true
        const radius = (node.id === hovered ? 8 : 5.5) + degree * 0.9 + sizeBoost(node.size)
        ctx.globalAlpha = isDimmed(node.id) ? 0.3 : 1
        ctx.fillStyle = hot ? COLOR_HOT : colorForDegree(links)
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
        ctx.fill()
        if (node.id === hovered || node.id === sim.dragId) {
          ctx.strokeStyle = 'rgba(106, 176, 255, 0.7)'
          ctx.lineWidth = 1.5 / sim.zoom
          ctx.beginPath()
          ctx.arc(p.x, p.y, radius + 3, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.fillStyle = hot ? '#dbe7f3' : '#8b98a6'
        ctx.font = `${11 / sim.zoom}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        const label = node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title
        ctx.fillText(label, p.x, p.y + radius + 13 / sim.zoom)
        ctx.globalAlpha = 1
      }

      ctx.restore()
      if (!disposed) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)

    const onPointerDown = (event: PointerEvent): void => {
      canvas.setPointerCapture(event.pointerId)
      const { x, y } = eventPos(event)
      sim.lastX = x
      sim.lastY = y
      sim.moved = false
      const hit = hitNode(x, y)
      if (hit) {
        sim.dragId = hit
      } else {
        sim.panning = true
      }
      canvas.style.cursor = hit ? 'grabbing' : 'grabbing'
    }

    const onPointerMove = (event: PointerEvent): void => {
      const { x, y } = eventPos(event)
      if (sim.dragId) {
        if (Math.hypot(x - sim.lastX, y - sim.lastY) > CLICK_TOLERANCE) sim.moved = true
        const w = toWorld(x, y)
        const p = sim.pos.get(sim.dragId)
        if (p) {
          p.x = w.x
          p.y = w.y
          p.vx = 0
          p.vy = 0
        }
        sim.lastX = x
        sim.lastY = y
        return
      }
      if (sim.panning) {
        sim.panX += x - sim.lastX
        sim.panY += y - sim.lastY
        sim.lastX = x
        sim.lastY = y
        return
      }
      const hit = hitNode(x, y)
      sim.hoverId = hit
      canvas.style.cursor = hit ? 'pointer' : 'default'
    }

    const onPointerUp = (): void => {
      const wasClick = sim.dragId !== null && !sim.moved
      const id = sim.dragId
      sim.dragId = null
      sim.panning = false
      canvas.style.cursor = 'default'
      if (wasClick && id) openNoteRef.current(id)
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      const before = toWorld(sx, sy)
      sim.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, sim.zoom * Math.exp(-event.deltaY * 0.0012)))
      const after = toWorld(sx, sy)
      sim.panX += (after.x - before.x) * sim.zoom
      sim.panY += (after.y - before.y) * sim.zoom
    }

    const onLeave = (): void => {
      sim.hoverId = null
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <main className="graph">
      <header className="graph__header">
        <h1 className="graph__title">Graph</h1>
        <span className="graph__stats">
          {nodes.length} {nodes.length === 1 ? 'note' : 'notes'} · {edges.length}{' '}
          {edges.length === 1 ? 'link' : 'links'}
        </span>
        <span className="graph__legend" aria-label="Node colors">
          <span className="graph__legend-item">
            <span className="graph__dot" style={{ background: COLOR_ISOLATED }} />
            Isolated
          </span>
          <span className="graph__legend-item">
            <span className="graph__dot" style={{ background: COLOR_LINKED }} />
            Linked
          </span>
          <span className="graph__legend-item">
            <span className="graph__dot" style={{ background: COLOR_HUB }} />
            Hub (3+)
          </span>
        </span>
      </header>
      <div className="graph__wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="graph__canvas" />
        {nodes.length === 0 && (
          <p className="graph__empty">No notes yet — create one and link it with [[brackets]].</p>
        )}
      </div>
    </main>
  )
}

export default Graph
