import Header from './components/Header'
import TrafficLight from './components/TrafficLight'
import TriggerButton from './components/TriggerButton'
import InspectionPanel from './components/InspectionPanel'
import DiagnosticPanel from './components/DiagnosticPanel'
import { useInspections } from './hooks/useInspections'
import { useCommands } from './hooks/useCommands'
import { useBridgeStatus } from './hooks/useBridgeStatus'

export default function App() {
  const { latestInspection, history, loading, clearDisplay } = useInspections()
  const { trigger, sendCommand, sending } = useCommands()
  const bridgeStatus = useBridgeStatus()

  const currentResult = latestInspection?.result || null

  return (
    <div className="app">
      <Header bridgeStatus={bridgeStatus} />

      <main className="main">
        <div className="main-top">
          <TrafficLight result={currentResult} />
          <div className="main-top__buttons">
            <TriggerButton
              onTrigger={trigger}
              sending={sending}
              disabled={!bridgeStatus?.cameraConnected}
            />
            <button className="btn-clear" onClick={clearDisplay} title="Limpiar pantalla">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              LIMPIAR
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading">Cargando...</div>
        ) : (
          <InspectionPanel inspection={latestInspection} history={history} />
        )}
      </main>

      <DiagnosticPanel bridgeStatus={bridgeStatus} onSendCommand={sendCommand} />

      <footer className="footer">
        <span>Air Hive &copy; {new Date().getFullYear()}</span>
        <span className="footer-version">QMS v1.0</span>
      </footer>
    </div>
  )
}
