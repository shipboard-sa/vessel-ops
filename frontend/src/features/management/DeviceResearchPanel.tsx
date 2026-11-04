/**
 * Purpose: "🔍 Research with Claude" panel on the device screen - starts a background headless-
 *   Claude job that reads a manual and drafts make/model, maintenance tasks and spare parts; shows
 *   progress; lets the owner apply pieces of the draft individually through the ORDINARY endpoints
 *   (nothing here writes to the tree directly).
 * Version: v3 (2026-09-23) - v3 (tracker #76, no-detour): "+ Add to catalog" on a spare whose
 *   name is already in the catalog (409) uses THAT item - links it to this device (added to its
 *   existing systems, not replacing them) and says "used the existing item X" - instead of erroring.
 *   v2 (2026-09-23) - v2: "✓ Added" on a suggested task / spare links to the task or item it
 *   created (ids from POST /tasks and POST /items) (tracker #74).
 *   v1 (2026-09-22)
 * Scope: PRODUCTION - mx-inv frontend, management feature (tracker #50 - the GUI the owner asked for
 *   after the 2026-09-22 chat-driven calibration round; see CHECKPOINT.md and
 *   references/DEVICE_MANUAL_RESEARCH_INSTRUCTIONS.md, the living recipe this job follows).
 * Architecture: Mirrors  ResearchPanel.tsx (same job-poll-apply shape, same
 *   never-auto-commit rule) against backend/routers/device_research.py. Mounted by SystemScreen
 *   next to DeviceDetails. Job id persisted in localStorage so a page reload re-attaches to a
 *   still-running (or since-finished) job; a 404 on poll (server restarted, job forgotten) is
 *   handled silently, same as routing's panel.
 */
import { useEffect, useRef, useState } from 'react'
import { useUpdateSystem, useCreateTask } from './mutations'
import { useCreateItem, useSetItemSystems } from '../warehouse/mutations'
import type { SystemInfo } from '../../api/types'
import { RecordLink } from '../../components/RecordLink'
import { ApiError, apiGet } from '../../api/client'

const POLL_MS = 4000
const JOB_KEY = 'mx-inv-device-research-job'

interface DraftTask {
  name: string
  period: string | null
  interval_type: string
  description: string
  source: string
}
interface DraftSpare {
  item_name: string
  item_type: string
  why: string
  source: string
}
interface Draft {
  device_name: string
  make_model: string | null
  manual_ref: string | null
  key_specs: string[]
  tasks: DraftTask[]
  spares: DraftSpare[]
  notes: string | null
  needs_your_answer: string[]
  sources_used: string[]
  incomplete: boolean
}
interface JobSnapshot {
  id: string
  device_name: string
  status: 'running' | 'done' | 'cancelled' | 'error'
  error: string | null
  draft: Draft | null
  run_status: 'ok' | 'failed' | null
  run_error: string | null
  seconds: number
  cost_usd: number
  warnings: string[]
}

export function DeviceResearchPanel({ system }: { system: SystemInfo }) {
  const [availability, setAvailability] = useState<{ available: boolean; reason: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [manualPaths, setManualPaths] = useState('')
  const [job, setJob] = useState<JobSnapshot | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  // draft index -> id of the record it created (null when the response carried no id)
  const [addedTasks, setAddedTasks] = useState<Map<number, number | null>>(new Map())
  const [addedSpares, setAddedSpares] = useState<Map<number, number | null>>(new Map())
  // tracker #76: spares whose name already existed - the existing item was linked instead
  const [existingSpares, setExistingSpares] = useState<Map<number, string>>(new Map())
  const [spareError, setSpareError] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)

  const updateSystem = useUpdateSystem()
  const createTask = useCreateTask()
  const createItem = useCreateItem()
  const setItemSystems = useSetItemSystems()

  useEffect(() => {
    fetch('/api/device-research/status')
      .then((r) => r.json())
      .then((d) => setAvailability(d))
      .catch(() => setAvailability({ available: false, reason: 'Could not reach the research service.' }))
  }, [])

  const poll = (id: string) => {
    fetch(`/api/device-research/${id}`).then((r) => {
      if (r.status === 404) {
        localStorage.removeItem(JOB_KEY)
        jobIdRef.current = null
        setJob(null)
        return
      }
      r.json().then((snap: JobSnapshot) => {
        setJob(snap)
        if (snap.status !== 'running') {
          localStorage.removeItem(JOB_KEY)
          jobIdRef.current = null
        }
      })
    })
  }

  useEffect(() => {
    const remembered = localStorage.getItem(JOB_KEY)
    if (remembered) {
      jobIdRef.current = remembered
      poll(remembered)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (job?.status !== 'running') return
    const id = jobIdRef.current
    if (!id) return
    const t = setInterval(() => poll(id), POLL_MS)
    return () => clearInterval(t)
  }, [job?.status])

  const start = () => {
    setStartError(null)
    const form = new FormData()
    form.set('device_name', system.name)
    form.set('manual_paths', manualPaths)
    if (system.parent_name) form.set('parent_system', system.parent_name)
    if (system.make_model) form.set('existing_make_model', system.make_model)
    if (system.notes) form.set('existing_notes', system.notes)
    fetch('/api/device-research', { method: 'POST', body: form }).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setStartError(body.detail || `failed: ${r.status}`)
        return
      }
      const { id } = await r.json()
      jobIdRef.current = id
      localStorage.setItem(JOB_KEY, id)
      setConfirming(false)
      poll(id)
    })
  }

  const cancel = () => {
    const id = jobIdRef.current
    if (!id) return
    fetch(`/api/device-research/${id}`, { method: 'DELETE' }).then(() => poll(id))
  }

  const applyMakeModel = (draft: Draft) => {
    updateSystem.mutate({
      name: system.name,
      fields: {
        make_model: draft.make_model ?? undefined,
        manual_ref: draft.manual_ref ?? undefined,
        notes: [system.notes, draft.notes].filter(Boolean).join('\n\n') || undefined,
      },
    })
  }

  const addTask = (t: DraftTask, i: number) => {
    createTask.mutate(
      {
        system: system.name, task_name: t.name, description: `${t.description}\n\nSource: ${t.source}`,
        period: t.period ?? 'immediate', interval_type: t.period ? t.interval_type : 'break_fix',
        task_kind: t.period ? 'recurring' : 'one_off',
      },
      { onSuccess: (res) => setAddedTasks((s) => new Map(s).set(i, (res as { task_id?: number }).task_id ?? null)) },
    )
  }

  const addSpare = (s: DraftSpare, i: number) => {
    setSpareError(null)
    createItem.mutate(
      { item_name: s.item_name, item_type: s.item_type, notes: `${s.why}\n\nSource: ${s.source}` },
      {
        onSuccess: (res) => {
          const id = (res as { item_id?: number }).item_id
          if (id) setItemSystems.mutate({ itemId: id, systems: [system.name] })
          setAddedSpares((set) => new Map(set).set(i, id ?? null))
        },
        onError: (err) => {
          // Name already in the catalog (same 409 NewStuffItemForm handles): use that item and
          // carry on linking it - ADDED to whatever it already serves, never replacing that.
          if (err instanceof ApiError && err.status === 409 && err.detail) {
            const { item_id, item_name } = err.detail as { item_id: number; item_name: string }
            apiGet<string[]>(`/items/${item_id}/systems`)
              .catch(() => [] as string[])
              .then((current) => {
                if (!current.includes(system.name)) {
                  setItemSystems.mutate({ itemId: item_id, systems: [...current, system.name] })
                }
                setExistingSpares((m) => new Map(m).set(i, item_name))
                setAddedSpares((set) => new Map(set).set(i, item_id))
              })
          } else {
            setSpareError(`Could not add ${s.item_name}: ${(err as Error).message}`)
          }
        },
      },
    )
  }

  if (!availability) return null

  const running = job?.status === 'running'

  return (
    <section className="system-section">
      <h3>🔍 Research with Claude</h3>

      {!confirming && !running && (
        <>
          <button
            type="button" onClick={() => setConfirming(true)}
            disabled={!availability.available}
          >
            🔍 Research with Claude
          </button>
          {!availability.available && <p className="mgmt-status">{availability.reason}</p>}
        </>
      )}

      {confirming && (
        <div className="mgmt-inline-form" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <p className="mgmt-status">
            Reads a manual with the Read tool and drafts make/model, maintenance tasks and spare
            parts for <strong>{system.name}</strong> - nothing is written until you apply it below.
            Runs on your Claude subscription and counts against your weekly allotment.
          </p>
          <label style={{ width: '100%' }}>
            Manual path(s) inside your Manuals folder (one per line, blank to let it search)
            <textarea
              rows={2} style={{ width: '100%' }}
              value={manualPaths} onChange={(e) => setManualPaths(e.target.value)}
              placeholder="Electrical\Victron\34439-Orion-Tr_Smart_DC-DC_Charger-pdf-en.pdf"
            />
          </label>
          <div className="mgmt-inline-form">
            <button type="button" onClick={start}>Start research</button>
            <button type="button" onClick={() => setConfirming(false)}>Not now</button>
          </div>
          {startError && <p className="mgmt-status mgmt-status--error">{startError}</p>}
        </div>
      )}

      {job && (
        <div className="system-details">
          <p className="mgmt-status">
            {job.status === 'running' && 'Researching…'}
            {job.status === 'done' && 'Research finished'}
            {job.status === 'cancelled' && 'Research cancelled'}
            {job.status === 'error' && `Research stopped: ${job.error ?? job.run_error ?? 'unknown error'}`}
            {job.seconds > 0 && ` · ${job.seconds.toFixed(0)}s · $${job.cost_usd.toFixed(2)}`}
          </p>
          {running && <button type="button" onClick={cancel}>Cancel</button>}
          {job.warnings.length > 0 && (
            <ul className="system-rows system-rows--static">
              {job.warnings.map((w) => <li key={w}>⚠️ {w}</li>)}
            </ul>
          )}

          {job.draft && (
            <div className="system-details">
              {job.draft.incomplete ? (
                <p className="mgmt-status mgmt-status--error">{job.draft.notes}</p>
              ) : (
                <>
                  <p><strong>Make/model:</strong> {job.draft.make_model ?? '(none found)'}</p>
                  <p><strong>Manual:</strong> {job.draft.manual_ref ?? '(none found)'}</p>
                  {job.draft.key_specs.length > 0 && (
                    <ul className="system-rows system-rows--static">
                      {job.draft.key_specs.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                  )}
                  {(job.draft.make_model || job.draft.manual_ref) && (
                    <button type="button" onClick={() => applyMakeModel(job.draft!)}
                      disabled={updateSystem.isPending}>
                      ✓ Apply make/model + manual to this device
                    </button>
                  )}

                  {job.draft.tasks.length > 0 && (
                    <>
                      <h4>Suggested tasks</h4>
                      <ul className="system-rows system-rows--static">
                        {job.draft.tasks.map((t, i) => (
                          <li key={i}>
                            <span className="system-row-name">{t.name}</span>
                            <span className="systems-tree-meta">
                              {t.period ? `every ${t.period} ${t.interval_type}` : 'one-off'} · {t.source}
                            </span>
                            {addedTasks.has(i) ? (
                              <span className="system-saved">
                                ✓ Added
                                {addedTasks.get(i) != null && (
                                  <>{' - '}<RecordLink to={{ kind: 'task', id: addedTasks.get(i)! }}>open task</RecordLink></>
                                )}
                              </span>
                            ) : (
                              <button type="button" onClick={() => addTask(t, i)}>+ Add task</button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {job.draft.spares.length > 0 && (
                    <>
                      <h4>Suggested spares</h4>
                      <ul className="system-rows system-rows--static">
                        {job.draft.spares.map((s, i) => (
                          <li key={i}>
                            <span className="system-part-type">{s.item_type}</span>
                            <span className="system-row-name">{s.item_name}</span>
                            <span className="systems-tree-meta">{s.source}</span>
                            {addedSpares.has(i) ? (
                              <span className="system-saved">
                                {existingSpares.has(i) ? `✓ Linked - used the existing item ${existingSpares.get(i)}` : '✓ Added'}
                                {addedSpares.get(i) != null && (
                                  <>{' - '}<RecordLink to={{ kind: 'item', id: addedSpares.get(i)! }}>open item</RecordLink></>
                                )}
                              </span>
                            ) : (
                              <button type="button" onClick={() => addSpare(s, i)}>+ Add to catalog</button>
                            )}
                          </li>
                        ))}
                      </ul>
                      {spareError && <p className="mgmt-status mgmt-status--error">{spareError}</p>}
                    </>
                  )}

                  {job.draft.needs_your_answer.length > 0 && (
                    <>
                      <h4>Needs your answer</h4>
                      <ul className="system-rows system-rows--static">
                        {job.draft.needs_your_answer.map((q) => <li key={q}>{q}</li>)}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
