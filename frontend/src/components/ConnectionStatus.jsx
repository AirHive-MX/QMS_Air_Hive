export default function ConnectionStatus({ bridgeStatus }) {
  const supabaseOk = bridgeStatus?.supabaseOk
  const bridgeAlive = bridgeStatus?.bridgeAlive
  const cameraConnected = bridgeStatus?.cameraConnected

  return (
    <div className="conn-status">
      <StatusIndicator
        label="Cloud"
        ok={supabaseOk}
        detail={supabaseOk ? 'Conectado' : 'Sin conexion'}
      />
      <StatusIndicator
        label="Agente"
        ok={bridgeAlive}
        detail={bridgeAlive ? 'Activo' : 'Inactivo'}
      />
      <StatusIndicator
        label="Camara"
        ok={cameraConnected}
        detail={
          cameraConnected
            ? `${bridgeStatus.camera_model || '?'} | ${bridgeStatus.camera_mode || '?'}`
            : 'Sin conexion'
        }
      />
    </div>
  )
}

function StatusIndicator({ label, ok, detail }) {
  return (
    <div className={`conn-ind ${ok ? 'conn-ind--on' : 'conn-ind--off'}`}>
      <span className="conn-ind__dot" />
      <div className="conn-ind__info">
        <span className="conn-ind__label">{label}</span>
        <span className="conn-ind__detail">{detail}</span>
      </div>
    </div>
  )
}
