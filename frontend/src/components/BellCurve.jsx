import { useMemo } from 'react'

/**
 * Gaussian (bell) curve visualization for a single measurement.
 * Shows μ, ±1σ ±2σ ±3σ bands, 2.5% tail shading, optional USL/LSL,
 * and the actual data points as ticks on the baseline.
 */
const W = 360
const H = 180
const PADDING = { top: 12, right: 14, bottom: 24, left: 14 }
const CHART_W = W - PADDING.left - PADDING.right
const CHART_H = H - PADDING.top - PADDING.bottom

function gaussian(x, mu, sigma) {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma))
}

export default function BellCurve({ name, values, mu, sigma, usl, lsl, nominal, unit = 'mm' }) {
  const sixSigma = sigma != null ? 6 * sigma : null
  const SAMPLES = 120

  const data = useMemo(() => {
    if (mu == null || sigma == null || sigma <= 0) return null

    // X axis span: at least ±4σ, but extend to include USL/LSL if outside
    const candidates = [mu - 4 * sigma, mu + 4 * sigma]
    if (usl != null) candidates.push(usl)
    if (lsl != null) candidates.push(lsl)
    if (nominal != null) candidates.push(nominal)
    values.forEach((v) => candidates.push(v))
    const xMin = Math.min(...candidates)
    const xMax = Math.max(...candidates)
    const padding = (xMax - xMin) * 0.05
    const xLo = xMin - padding
    const xHi = xMax + padding

    const xToPx = (x) => PADDING.left + ((x - xLo) / (xHi - xLo)) * CHART_W
    const yToPx = (y01) => PADDING.top + (1 - y01) * CHART_H

    // Sample curve points
    const points = []
    for (let i = 0; i <= SAMPLES; i++) {
      const x = xLo + (i / SAMPLES) * (xHi - xLo)
      const y = gaussian(x, mu, sigma)
      points.push([xToPx(x), yToPx(y)])
    }

    // Build a closed path for filling (curve + baseline)
    const baselineY = yToPx(0)
    const curvePath =
      `M ${points[0][0]} ${baselineY} ` +
      points.map(([px, py]) => `L ${px} ${py}`).join(' ') +
      ` L ${points[points.length - 1][0]} ${baselineY} Z`

    // Helper: clipped path for a sub-range of the curve
    const subPath = (xStart, xEnd) => {
      const start = Math.max(xStart, xLo)
      const end = Math.min(xEnd, xHi)
      if (start >= end) return null
      const out = []
      for (let i = 0; i <= SAMPLES; i++) {
        const x = xLo + (i / SAMPLES) * (xHi - xLo)
        if (x < start || x > end) continue
        const y = gaussian(x, mu, sigma)
        out.push([xToPx(x), yToPx(y)])
      }
      if (!out.length) return null
      return (
        `M ${xToPx(start)} ${baselineY} ` +
        `L ${out[0][0]} ${baselineY} ` +
        out.map(([px, py]) => `L ${px} ${py}`).join(' ') +
        ` L ${xToPx(end)} ${baselineY} Z`
      )
    }

    const path1Sigma = subPath(mu - sigma, mu + sigma) // ±1σ band (68%)
    const path2SigmaL = subPath(mu - 2 * sigma, mu - sigma) // -1σ..-2σ
    const path2SigmaR = subPath(mu + sigma, mu + 2 * sigma) // +1σ..+2σ
    const path3SigmaL = subPath(mu - 3 * sigma, mu - 2 * sigma)
    const path3SigmaR = subPath(mu + 2 * sigma, mu + 3 * sigma)
    const tailLeft = subPath(xLo, mu - 1.96 * sigma) // 2.5% left tail
    const tailRight = subPath(mu + 1.96 * sigma, xHi) // 2.5% right tail

    return {
      xLo, xHi, xToPx, yToPx, baselineY,
      curvePath,
      path1Sigma, path2SigmaL, path2SigmaR, path3SigmaL, path3SigmaR,
      tailLeft, tailRight,
    }
  }, [mu, sigma, usl, lsl, nominal, values])

  if (!data) {
    return (
      <div className="bell-card">
        <div className="bell-card__header">
          <span className="bell-card__name">{name}</span>
        </div>
        <div className="bell-card__empty">
          {sigma === 0
            ? 'σ = 0 — todas las lecturas son idénticas'
            : 'Datos insuficientes (n &lt; 2)'}
        </div>
      </div>
    )
  }

  const { xToPx, yToPx, baselineY } = data
  const tickPx = (x) => xToPx(x)

  return (
    <div className="bell-card">
      <div className="bell-card__header">
        <span className="bell-card__name">{name}</span>
        <span className="bell-card__meta">
          μ <strong>{mu.toFixed(3)}</strong> {unit}
        </span>
      </div>
      <div className="bell-card__kpis">
        <div className="bell-card__kpi">
          <span className="bell-card__kpi-label">σ (desv. estándar)</span>
          <span className="bell-card__kpi-val">{sigma.toFixed(4)}</span>
          <span className="bell-card__kpi-unit">{unit}</span>
        </div>
        <div className="bell-card__kpi">
          <span className="bell-card__kpi-label">6σ (amplitud)</span>
          <span className="bell-card__kpi-val">{sixSigma.toFixed(4)}</span>
          <span className="bell-card__kpi-unit">{unit}</span>
        </div>
      </div>
      <svg className="bell-card__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* Outer ±3σ region */}
        {data.path3SigmaL && <path d={data.path3SigmaL} fill="var(--accent)" opacity="0.08" />}
        {data.path3SigmaR && <path d={data.path3SigmaR} fill="var(--accent)" opacity="0.08" />}
        {/* ±2σ region */}
        {data.path2SigmaL && <path d={data.path2SigmaL} fill="var(--accent)" opacity="0.18" />}
        {data.path2SigmaR && <path d={data.path2SigmaR} fill="var(--accent)" opacity="0.18" />}
        {/* ±1σ region */}
        {data.path1Sigma && <path d={data.path1Sigma} fill="var(--accent)" opacity="0.32" />}
        {/* 2.5% tails - red highlight */}
        {data.tailLeft && <path d={data.tailLeft} fill="var(--fail)" opacity="0.35" />}
        {data.tailRight && <path d={data.tailRight} fill="var(--fail)" opacity="0.35" />}

        {/* Curve outline */}
        <path d={data.curvePath} fill="none" stroke="var(--accent)" strokeWidth="1.5" />

        {/* Baseline */}
        <line
          x1={PADDING.left}
          y1={baselineY}
          x2={W - PADDING.right}
          y2={baselineY}
          stroke="var(--border)"
          strokeWidth="1"
        />

        {/* Mean line */}
        <line
          x1={tickPx(mu)} y1={PADDING.top}
          x2={tickPx(mu)} y2={baselineY}
          stroke="var(--accent)" strokeWidth="2"
        />
        <text x={tickPx(mu)} y={PADDING.top - 2} textAnchor="middle" fill="var(--accent)" fontSize="9" fontWeight="700">μ</text>

        {/* ±1σ, ±2σ, ±3σ vertical markers (dashed) */}
        {[1, 2, 3].map((k) => (
          <g key={k}>
            <line
              x1={tickPx(mu - k * sigma)} y1={yToPx(gaussian(mu - k * sigma, mu, sigma))}
              x2={tickPx(mu - k * sigma)} y2={baselineY}
              stroke="var(--accent)" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.6"
            />
            <line
              x1={tickPx(mu + k * sigma)} y1={yToPx(gaussian(mu + k * sigma, mu, sigma))}
              x2={tickPx(mu + k * sigma)} y2={baselineY}
              stroke="var(--accent)" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.6"
            />
            <text x={tickPx(mu - k * sigma)} y={baselineY + 10} textAnchor="middle" fill="var(--text-muted)" fontSize="8">-{k}σ</text>
            <text x={tickPx(mu + k * sigma)} y={baselineY + 10} textAnchor="middle" fill="var(--text-muted)" fontSize="8">+{k}σ</text>
          </g>
        ))}

        {/* USL/LSL lines */}
        {lsl != null && (
          <g>
            <line x1={tickPx(lsl)} y1={PADDING.top} x2={tickPx(lsl)} y2={baselineY} stroke="var(--fail)" strokeWidth="1.5" strokeDasharray="5,3" />
            <text x={tickPx(lsl)} y={PADDING.top + 8} textAnchor="middle" fill="var(--fail)" fontSize="9" fontWeight="700">LSL</text>
          </g>
        )}
        {usl != null && (
          <g>
            <line x1={tickPx(usl)} y1={PADDING.top} x2={tickPx(usl)} y2={baselineY} stroke="var(--fail)" strokeWidth="1.5" strokeDasharray="5,3" />
            <text x={tickPx(usl)} y={PADDING.top + 8} textAnchor="middle" fill="var(--fail)" fontSize="9" fontWeight="700">USL</text>
          </g>
        )}
        {nominal != null && (
          <line x1={tickPx(nominal)} y1={baselineY - 4} x2={tickPx(nominal)} y2={baselineY + 4} stroke="var(--pass)" strokeWidth="2" />
        )}

        {/* Data points as ticks on baseline */}
        {values.map((v, i) => (
          <line
            key={i}
            x1={tickPx(v)} y1={baselineY - 3}
            x2={tickPx(v)} y2={baselineY + 3}
            stroke="var(--text-primary)" strokeWidth="1.2" opacity="0.7"
          />
        ))}
      </svg>
      <div className="bell-card__legend">
        <span className="bell-card__legend-item">
          <span className="bell-card__legend-swatch" style={{ background: 'var(--accent)', opacity: 0.32 }} />
          ±1σ (68%)
        </span>
        <span className="bell-card__legend-item">
          <span className="bell-card__legend-swatch" style={{ background: 'var(--accent)', opacity: 0.18 }} />
          ±2σ (95%)
        </span>
        <span className="bell-card__legend-item">
          <span className="bell-card__legend-swatch" style={{ background: 'var(--fail)', opacity: 0.35 }} />
          colas 2.5%
        </span>
      </div>
    </div>
  )
}
