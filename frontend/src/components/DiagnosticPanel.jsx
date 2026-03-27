import { useState, useEffect, useRef } from 'react'
import { useLogs } from '../hooks/useLogs'

const LEVEL_ICONS = {
  info: '\u2139\uFE0F',
  warn: '\u26A0\uFE0F',
  error: '\u274C',
  data: '\u25C0',
}

const LEVEL_COLORS = {
  info: 'var(--text-secondary)',
  warn: '#f59e0b',
  error: 'var(--fail)',
  data: 'var(--accent)',
}

export default function DiagnosticPanel({ bridgeStatus, onSendCommand }) {
  const [isOpen, setIsOpen] = useState(false)
  const logs = useLogs(80)
  const scrollRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  function handleScroll() {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40)
  }

  return (
    <div className={`diag ${isOpen ? 'diag--open' : ''}`}>
      <button className="diag__toggle" onClick={() => setIsOpen(!isOpen)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20V10M18 20V4M6 20v-4" strokeLinecap="round" />
        </svg>
        <span>Diagnostico</span>
        <span className="diag__count">{logs.length}</span>
      </button>

      {isOpen && (
        <div className="diag__body">
          {/* Connection info */}
          <div className="diag__section">
            <h4>Conexion</h4>
            <div className="diag__grid">
              <span className="diag__key">IP</span>
              <span className="diag__val">{bridgeStatus?.camera_ip || '-'}</span>
              <span className="diag__key">Puerto</span>
              <span className="diag__val">8500</span>
              <span className="diag__key">Modelo</span>
              <span className="diag__val">{bridgeStatus?.camera_model || '-'}</span>
              <span className="diag__key">Modo</span>
              <span className="diag__val">{bridgeStatus?.camera_mode || '-'}</span>
              <span className="diag__key">Firmware</span>
              <span className="diag__val">{bridgeStatus?.firmware_version || '-'}</span>
              <span className="diag__key">Heartbeat</span>
              <span className="diag__val">
                {bridgeStatus?.last_heartbeat
                  ? new Date(bridgeStatus.last_heartbeat).toLocaleTimeString('es-MX')
                  : '-'}
              </span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="diag__section">
            <h4>Test de conexion</h4>
            <div className="diag__actions">
              <button className="diag__btn" onClick={() => onSendCommand('ECHO')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
                Echo Test
              </button>
              <button className="diag__btn" onClick={() => onSendCommand('PR')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h16M4 18h8" />
                </svg>
                Get Program
              </button>
              <button className="diag__btn" onClick={() => onSendCommand('MOR')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Get Mode
              </button>
            </div>
          </div>

          {/* Live log */}
          <div className="diag__section diag__section--log">
            <h4>Log en vivo
              <span className="diag__live-dot" />
            </h4>
            <div className="diag__log" ref={scrollRef} onScroll={handleScroll}>
              {logs.length === 0 ? (
                <div className="diag__empty">Sin logs aun...</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className={`diag__entry diag__entry--${log.level}`}>
                    <span className="diag__entry-time">
                      {new Date(log.created_at).toLocaleTimeString('es-MX', { hour12: false })}
                    </span>
                    <span className="diag__entry-level" style={{ color: LEVEL_COLORS[log.level] }}>
                      {log.level.toUpperCase()}
                    </span>
                    <span className="diag__entry-source">[{log.source}]</span>
                    <span className="diag__entry-msg">{log.message}</span>
                    {log.raw_data && (
                      <div className="diag__entry-raw">{log.raw_data}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
