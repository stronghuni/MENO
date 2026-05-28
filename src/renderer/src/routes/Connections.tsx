import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EntityIndexItem, Meeting, Project } from '../../../shared/types'
import { getApi } from '../lib/api'
import { projectColor, NO_PROJECT_COLOR } from '../lib/projectColor'

/**
 * Obsidian-style force graph of the meeting relationship web. Nodes are
 * meetings (colored by project), sized by connection count; two meetings are
 * linked by a thin straight line when they share entities (people/topics).
 * Hand-rolled force sim on canvas (no d3). Hover a node to spotlight it and
 * its neighbours (the rest dim out); click to open the meeting. Hover an edge
 * to see what the two meetings share.
 */

interface GNode {
  meetingId: string
  label: string
  color: string
  r: number
  x: number
  y: number
  vx: number
  vy: number
}
interface GEdge {
  a: number
  b: number
  weight: number
  shared: string[]
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

export default function Connections(): React.JSX.Element {
  const api = getApi()
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<GNode[]>([])
  const edgesRef = useRef<GEdge[]>([])
  const rafRef = useRef<number>(0)
  const hoverEdgeRef = useRef<number>(-1)
  const hoverNodeRef = useRef<number>(-1)
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 })
  const dragRef = useRef<{ node: GNode | null; panning: boolean; lastX: number; lastY: number }>({
    node: null,
    panning: false,
    lastX: 0,
    lastY: 0
  })
  const [empty, setEmpty] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null)

  const buildGraph = async (): Promise<void> => {
    if (!api) return
    const [meetings, index, projects] = await Promise.all([
      api.meetings.list() as Promise<Meeting[]>,
      api.graph.entityIndex() as Promise<EntityIndexItem[]>,
      api.projects.list() as Promise<Project[]>
    ])
    const projById = new Map(projects.map((p) => [p.id, p]))
    const meetingById = new Map(meetings.map((m) => [m.id, m]))

    // meetings that have any entity → graph nodes
    const used = new Set<string>()
    for (const e of index) for (const m of e.meetings) used.add(m.id)

    const cx = (canvasRef.current?.clientWidth ?? 800) / 2
    const cy = (canvasRef.current?.clientHeight ?? 600) / 2
    const rnd = (): number => (Math.random() - 0.5) * 240
    const nodes: GNode[] = []
    const idx = new Map<string, number>()
    for (const mid of used) {
      const m = meetingById.get(mid)
      if (!m) continue
      idx.set(mid, nodes.length)
      nodes.push({
        meetingId: mid,
        label: m.title,
        color: m.projectId ? projectColor(projById.get(m.projectId)) : NO_PROJECT_COLOR,
        r: 8,
        x: cx + rnd(),
        y: cy + rnd(),
        vx: 0,
        vy: 0
      })
    }

    // accumulate meeting-pair weights from shared entities
    const pairs = new Map<string, { a: number; b: number; weight: number; shared: string[] }>()
    for (const e of index) {
      const mids = e.meetings.map((m) => m.id).filter((id) => idx.has(id))
      const label = (e.type === 'person' ? '@' : '#') + e.name
      for (let i = 0; i < mids.length; i++) {
        for (let j = i + 1; j < mids.length; j++) {
          const ai = idx.get(mids[i])!
          const bi = idx.get(mids[j])!
          const key = ai < bi ? `${ai}-${bi}` : `${bi}-${ai}`
          let p = pairs.get(key)
          if (!p) {
            p = { a: Math.min(ai, bi), b: Math.max(ai, bi), weight: 0, shared: [] }
            pairs.set(key, p)
          }
          p.weight += e.type === 'person' ? 2 : 1
          p.shared.push(label)
        }
      }
    }
    // node radius by degree (connection count) → hubs read bigger
    const deg = new Array(nodes.length).fill(0)
    const built = Array.from(pairs.values())
    for (const e of built) {
      deg[e.a]++
      deg[e.b]++
    }
    nodes.forEach((nd, i) => {
      nd.r = 7 + Math.min(deg[i], 8) * 1.2
    })

    nodesRef.current = nodes
    edgesRef.current = built
    setEmpty(nodes.length === 0)
  }

  // ── Force simulation + render ───────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cssW = 0
    let cssH = 0
    const dpr = window.devicePixelRatio || 1
    const resize = (): void => {
      const rect = canvas.parentElement!.getBoundingClientRect()
      cssW = rect.width
      cssH = rect.height
      canvas.width = Math.floor(cssW * dpr)
      canvas.height = Math.floor(cssH * dpr)
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement!)

    const tick = (): void => {
      const nodes = nodesRef.current
      const edges = edgesRef.current
      const n = nodes.length
      for (let i = 0; i < n; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j]
          let dx = a.x - b.x
          let dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 < 0.01) {
            dx = Math.random()
            dy = Math.random()
            d2 = 1
          }
          const force = 5200 / d2
          const d = Math.sqrt(d2)
          const fx = (dx / d) * force
          const fy = (dy / d) * force
          a.vx += fx
          a.vy += fy
          b.vx -= fx
          b.vy -= fy
        }
      }
      for (const e of edges) {
        const a = nodes[e.a]
        const b = nodes[e.b]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        // higher shared weight → shorter target distance (pull closer)
        const target = Math.max(60, 150 - e.weight * 12)
        const k = (d - target) * 0.02
        const fx = (dx / d) * k
        const fy = (dy / d) * k
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
      const cx = cssW / 2
      const cy = cssH / 2
      const drag = dragRef.current
      for (const node of nodes) {
        node.vx += (cx - node.x) * 0.002
        node.vy += (cy - node.y) * 0.002
        node.vx *= 0.84
        node.vy *= 0.84
        if (node !== drag.node) {
          node.x += node.vx
          node.y += node.vy
        }
      }
      render()
      rafRef.current = requestAnimationFrame(tick)
    }

    const render = (): void => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const { scale, ox, oy } = viewRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)
      ctx.translate(ox, oy)
      ctx.scale(scale, scale)
      const nodes = nodesRef.current
      const edges = edgesRef.current
      const hoverEdge = hoverEdgeRef.current
      const hoverNode = hoverNodeRef.current
      const styles = getComputedStyle(document.documentElement)
      const accent = styles.getPropertyValue('--accent').trim() || '#2d5bd0'
      const lineRGB = styles.getPropertyValue('--text-muted').trim() || '#5a6678'
      const paper = styles.getPropertyValue('--bg').trim() || '#fbfbf9'
      const muted = styles.getPropertyValue('--text-muted').trim() || '#5a6678'

      // neighbourhood of the hovered node (for the spotlight dimming)
      let neighbours: Set<number> | null = null
      if (hoverNode >= 0) {
        neighbours = new Set<number>([hoverNode])
        for (const e of edges) {
          if (e.a === hoverNode) neighbours.add(e.b)
          else if (e.b === hoverNode) neighbours.add(e.a)
        }
      }

      // edges: thin straight lines in the muted ink colour. When a node is
      // hovered, its links light up in accent and everything else fades back.
      ctx.lineCap = 'round'
      ctx.shadowBlur = 0
      edges.forEach((e, i) => {
        const a = nodes[e.a]
        const b = nodes[e.b]
        const connected =
          (neighbours && (e.a === hoverNode || e.b === hoverNode)) || i === hoverEdge
        if (neighbours && !connected) {
          ctx.strokeStyle = lineRGB
          ctx.globalAlpha = 0.05
          ctx.lineWidth = 1 / scale
        } else if (connected) {
          ctx.strokeStyle = accent
          ctx.globalAlpha = 0.85
          ctx.lineWidth = (1.4 + Math.min(e.weight, 6) * 0.3) / scale
        } else {
          ctx.strokeStyle = lineRGB
          ctx.globalAlpha = 0.18
          ctx.lineWidth = (0.8 + Math.min(e.weight, 6) * 0.18) / scale
        }
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      })
      ctx.globalAlpha = 1

      // nodes: flat project-coloured dots with a thin paper ring so overlaps
      // stay legible. Non-neighbours dim when a node is hovered.
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const dim = neighbours ? !neighbours.has(i) : false
        ctx.globalAlpha = dim ? 0.25 : 1
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
        ctx.fillStyle = node.color
        ctx.fill()
        ctx.lineWidth = 1.5 / scale
        ctx.strokeStyle = paper
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // labels below each dot. They fade out when zoomed far out; when a node
      // is hovered only its neighbourhood keeps full-strength labels.
      const labelAlpha = scale < 0.55 ? 0 : Math.min(1, (scale - 0.45) / 0.3)
      if (labelAlpha > 0) {
        ctx.font = `${11 / scale}px -apple-system, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.lineJoin = 'round'
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]
          const dim = neighbours ? !neighbours.has(i) : false
          ctx.globalAlpha = dim ? labelAlpha * 0.2 : labelAlpha
          const label = node.label.length > 18 ? node.label.slice(0, 17) + '…' : node.label
          const ly = node.y + node.r + 3 / scale
          ctx.lineWidth = 3 / scale
          ctx.strokeStyle = paper
          ctx.strokeText(label, node.x, ly)
          ctx.fillStyle = dim || !neighbours ? muted : accent
          ctx.fillText(label, node.x, ly)
        }
        ctx.globalAlpha = 1
        ctx.textBaseline = 'alphabetic'
      }
    }

    tick()
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void buildGraph()
    if (!api) return
    const off = api.graph.onProgress((p) => setProgress({ current: p.current, total: p.total }))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  // ── Interaction ─────────────────────────────────────────────────────
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const { scale, ox, oy } = viewRef.current
    return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale }
  }
  const hitNode = (wx: number, wy: number): GNode | null => {
    const nodes = nodesRef.current
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]
      if (Math.hypot(wx - node.x, wy - node.y) <= node.r + 4) return node
    }
    return null
  }
  const zoomBy = (factor: number): void => {
    const v = viewRef.current
    const c = canvasRef.current
    if (!c) return
    const mx = c.clientWidth / 2
    const my = c.clientHeight / 2
    v.ox = mx - (mx - v.ox) * factor
    v.oy = my - (my - v.oy) * factor
    v.scale = Math.max(0.3, Math.min(3, v.scale * factor))
  }
  const resetView = (): void => {
    viewRef.current = { scale: 1, ox: 0, oy: 0 }
  }
  const onPointerDown = (e: React.PointerEvent): void => {
    const w = toWorld(e.clientX, e.clientY)
    const node = hitNode(w.x, w.y)
    dragRef.current = { node, panning: !node, lastX: e.clientX, lastY: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    if (drag.node) {
      const w = toWorld(e.clientX, e.clientY)
      drag.node.x = w.x
      drag.node.y = w.y
      drag.node.vx = 0
      drag.node.vy = 0
      return
    }
    if (drag.panning) {
      viewRef.current.ox += e.clientX - drag.lastX
      viewRef.current.oy += e.clientY - drag.lastY
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      return
    }
    // hover: node first (spotlight its neighbourhood), else nearest edge → tooltip
    const w = toWorld(e.clientX, e.clientY)
    const nodes = nodesRef.current
    const edges = edgesRef.current
    const overNode = hitNode(w.x, w.y)
    if (overNode) {
      hoverNodeRef.current = nodes.indexOf(overNode)
      hoverEdgeRef.current = -1
      if (tip) setTip(null)
      return
    }
    hoverNodeRef.current = -1
    let best = -1
    let bestD = 7 / viewRef.current.scale
    for (let i = 0; i < edges.length; i++) {
      const a = nodes[edges[i].a]
      const b = nodes[edges[i].b]
      const d = distToSegment(w.x, w.y, a.x, a.y, b.x, b.y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    hoverEdgeRef.current = best
    if (best >= 0) {
      const e2 = edges[best]
      const rect = canvasRef.current!.getBoundingClientRect()
      setTip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        lines: Array.from(new Set(e2.shared))
      })
    } else if (tip) {
      setTip(null)
    }
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    const moved = Math.abs(e.clientX - drag.lastX) + Math.abs(e.clientY - drag.lastY)
    if (drag.node && moved < 4) navigate(`/meeting/${drag.node.meetingId}`)
    dragRef.current = { node: null, panning: false, lastX: 0, lastY: 0 }
  }
  const onWheel = (e: React.WheelEvent): void => {
    const v = viewRef.current
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    v.ox = mx - (mx - v.ox) * factor
    v.oy = my - (my - v.oy) * factor
    v.scale = Math.max(0.3, Math.min(3, v.scale * factor))
  }

  const rebuild = async (): Promise<void> => {
    if (!api) return
    setRebuilding(true)
    setProgress({ current: 0, total: 0 })
    try {
      await api.graph.rebuild()
      await buildGraph()
    } finally {
      setRebuilding(false)
      setProgress(null)
    }
  }

  return (
    <div className="main">
      <header className="main-header">
        <h1>관계</h1>
        <button className="btn" onClick={rebuild} disabled={rebuilding}>
          {rebuilding
            ? progress && progress.total > 0
              ? `분석 중… ${progress.current}/${progress.total}`
              : '분석 중…'
            : '관계 다시 분석'}
        </button>
      </header>
      <div className="main-content" style={{ padding: 0, position: 'relative', overflow: 'hidden' }}>
        {empty && (
          <div className="empty-state" style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
            <h2>아직 연결할 회의가 없어요</h2>
            <p>
              회의가 쌓이고 참석자·주제가 겹치면 회의끼리 선으로 이어집니다. 기존 회의를 지금
              연결하려면 우측 상단 <b>관계 다시 분석</b>을 눌러주세요.
            </p>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="conn-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            hoverEdgeRef.current = -1
            hoverNodeRef.current = -1
            setTip(null)
          }}
          onWheel={onWheel}
        />
        {tip && (
          <div className="conn-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
            <div className="conn-tip-label">공유</div>
            {tip.lines.map((l, i) => (
              <span key={i} className="conn-tip-item">
                {l}
              </span>
            ))}
          </div>
        )}
        {!empty && (
          <div className="conn-zoom">
            <button onClick={() => zoomBy(1.2)} aria-label="확대" title="확대">
              +
            </button>
            <button onClick={() => zoomBy(1 / 1.2)} aria-label="축소" title="축소">
              −
            </button>
            <button onClick={resetView} aria-label="원래대로" title="원래대로">
              ⤢
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
