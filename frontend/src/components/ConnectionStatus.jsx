export default function ConnectionStatus({ bridgeStatus }) {
  const connected = bridgeStatus?.is_connected
  const mode = bridgeStatus?.camera_mode

  return (
    <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
      <span className="status-dot" />
      <div className="status-info">
        <span className="status-label">
          {connected ? 'Conectado' : 'Desconectado'}
        </span>
        {connected && mode && (
          <span className="status-detail">
            {bridgeStatus.camera_model} | {mode}
          </span>
        )}
      </div>
    </div>
  )
}
