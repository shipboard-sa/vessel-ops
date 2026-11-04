import { useState } from 'react'
import { useMeterStatus, useTelemetrySnapshot } from './useTelemetry'
import { useSetHoursReading } from './mutations'
import type { MeterStatus } from '../../api/types'
import { useSettings } from '../../api/settings'
import './TelemetryWidget.css'

// Meter names come from ⚙ Settings (engine_label / genset_label) - release package 2026-09-24.
function useMeterLabel(meter: 'engine' | 'genset'): string {
  const { data } = useSettings()
  return (meter === 'engine' ? data?.engine_label : data?.genset_label) ?? (meter === 'engine' ? 'Main engine' : 'Generator')
}

export function TelemetryWidget() {
  const [expanded, setExpanded] = useState(false)
  const { data: snapshot } = useTelemetrySnapshot()

  const fuelFrac = snapshot?.fuel_frac?.value
  const waterFrac = snapshot?.water_frac?.value

  return (
    <div className="telemetry-widget">
      <button type="button" className="telemetry-summary" onClick={() => setExpanded((v) => !v)}>
        {fuelFrac !== undefined && fuelFrac !== null && (
          <span>⛽ {Math.round(fuelFrac * 100)}%</span>
        )}
        {waterFrac !== undefined && waterFrac !== null && (
          <span>💧 {Math.round(waterFrac * 100)}%</span>
        )}
        <MeterSummary meter="engine" />
        <MeterSummary meter="genset" />
        <span className="telemetry-caret">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="telemetry-panel">
          <p className="mgmt-status">
            Drives the run-hours schedule. Type the reading off the hour meter; between
            readings it projects from your usual hours per year (or reads a live
            telemetry feed, if one has been wired in).
          </p>
          <MeterRow meter="engine" />
          <MeterRow meter="genset" />
        </div>
      )}
    </div>
  )
}

function MeterSummary({ meter }: { meter: 'engine' | 'genset' }) {
  const { data: status } = useMeterStatus(meter)
  if (!status || status.hours === null) return null
  const icon = meter === 'engine' ? '⚙️' : '🔧'
  return <span>{icon} {status.hours.toFixed(0)}h</span>
}

function MeterRow({ meter }: { meter: 'engine' | 'genset' }) {
  const { data: status } = useMeterStatus(meter)
  const setReading = useSetHoursReading()
  const label = useMeterLabel(meter)
  const [value, setValue] = useState('')

  if (!status) return null

  return (
    <div className="telemetry-meter-row">
      <div className="telemetry-meter-label">
        <strong>{label}</strong> — {describe(status)}
      </div>
      <input
        type="number" min={0} step={1}
        placeholder={status.hours !== null ? status.hours.toFixed(1) : 'hours'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        disabled={!value || setReading.isPending}
        onClick={() => {
          setReading.mutate({ meter, hours: Number(value) }, { onSuccess: () => setValue('') })
        }}
      >
        Update
      </button>
    </div>
  )
}

function describe(status: MeterStatus): string {
  if ((status.source === 'live' || status.source === 'influx') && status.hours !== null) {
    return `${status.hours.toFixed(1)} h · live (as of ${status.observed_at?.slice(0, 16) ?? '—'})`
  }
  if (status.source === 'estimate' && status.hours !== null) {
    return `~${status.hours.toFixed(0)} h · estimated from ${status.observed_at ?? '—'}`
  }
  return 'no reading yet'
}
