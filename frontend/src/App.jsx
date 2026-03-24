import Header from './components/Header'
import TrafficLight from './components/TrafficLight'
import TriggerButton from './components/TriggerButton'
import InspectionPanel from './components/InspectionPanel'
import { useInspections } from './hooks/useInspections'
import { useCommands } from './hooks/useCommands'
import { useBridgeStatus } from './hooks/useBridgeStatus'

export default function App() {
  const { latestInspection, history, loading } = useInspections()
  const { trigger, sending } = useCommands()
  const bridgeStatus = useBridgeStatus()

  const currentResult = latestInspection?.result || null

  return (
    <div className="app">
      <Header bridgeStatus={bridgeStatus} />

      <main className="main">
        <div className="main-top">
          <TrafficLight result={currentResult} />
          <TriggerButton
            onTrigger={trigger}
            sending={sending}
            disabled={!bridgeStatus?.is_connected}
          />
        </div>

        {loading ? (
          <div className="loading">Cargando...</div>
        ) : (
          <InspectionPanel inspection={latestInspection} history={history} />
        )}
      </main>

      <footer className="footer">
        <span>Air Hive &copy; {new Date().getFullYear()}</span>
        <span className="footer-version">QMS v1.0</span>
      </footer>
    </div>
  )
}
