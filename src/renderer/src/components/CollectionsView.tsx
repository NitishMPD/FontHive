import { useMemo, useState } from 'react'
import type { Collection, ConditionField, ConditionOp, SmartCondition, SmartRule } from '@shared/types'
import { useApp } from '../store'
import { collectionMembers } from '../lib/filter'
import Icon from './Icon'

const FIELDS: { value: ConditionField; label: string; ops: ConditionOp[] }[] = [
  { value: 'family', label: 'Family', ops: ['contains', 'equals', 'notEquals'] },
  { value: 'category', label: 'Category', ops: ['equals', 'notEquals'] },
  { value: 'provider', label: 'Provider', ops: ['equals', 'notEquals'] },
  { value: 'weight', label: 'Weight', ops: ['equals', 'gt', 'lt'] },
  { value: 'style', label: 'Style', ops: ['equals', 'notEquals'] },
  { value: 'active', label: 'Active', ops: ['isTrue', 'isFalse'] },
  { value: 'tag', label: 'Tag', ops: ['equals', 'notEquals'] },
  { value: 'rating', label: 'Rating', ops: ['equals', 'gt', 'lt'] },
  { value: 'axes', label: 'Variable', ops: ['hasAxis', 'isTrue'] }
]

const OP_LABEL: Record<ConditionOp, string> = {
  contains: 'contains',
  equals: 'is',
  notEquals: 'is not',
  gt: 'greater than',
  lt: 'less than',
  isTrue: 'is true',
  isFalse: 'is false',
  hasAxis: 'has axis'
}

function needsValue(op: ConditionOp): boolean {
  return op !== 'isTrue' && op !== 'isFalse'
}

export default function CollectionsView({ collectionId }: { collectionId: string }): React.JSX.Element {
  const collections = useApp((s) => s.collections)
  const fonts = useApp((s) => s.fonts)
  const saveCollection = useApp((s) => s.saveCollection)
  const deleteCollection = useApp((s) => s.deleteCollection)
  const setView = useApp((s) => s.setView)
  const toast = useApp((s) => s.toast)

  const existing = collections.find((c) => c.id === collectionId)
  const isNew = collectionId === 'new'

  const [name, setName] = useState(existing?.name ?? '')
  const [smart, setSmart] = useState(Boolean(existing?.rule))
  const [match, setMatch] = useState<'all' | 'any'>(existing?.rule?.match ?? 'all')
  const [conditions, setConditions] = useState<SmartCondition[]>(
    existing?.rule?.conditions ?? [{ field: 'category', op: 'equals', value: 'sans-serif' }]
  )

  const rule: SmartRule = { match, conditions }

  const preview = useMemo(() => {
    const draft: Collection = {
      id: collectionId,
      name,
      fontIds: existing?.fontIds ?? [],
      rule: smart ? rule : undefined,
      createdAt: existing?.createdAt ?? Date.now()
    }
    return collectionMembers(fonts, draft).length
  }, [fonts, smart, match, conditions, collectionId, existing, name])

  const patchCondition = (index: number, patch: Partial<SmartCondition>): void => {
    setConditions(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast('Give the collection a name first', 'error')
      return
    }
    const collection: Collection = {
      id: isNew ? `col-${Date.now().toString(36)}` : collectionId,
      name: trimmed,
      fontIds: existing?.fontIds ?? [],
      rule: smart ? { match, conditions } : undefined,
      createdAt: existing?.createdAt ?? Date.now()
    }
    await saveCollection(collection)
    toast(`Saved “${trimmed}”`, 'success')
    setView({ kind: 'collection', id: collection.id })
  }

  return (
    <div className="panel">
      <h2>{isNew ? 'New collection' : 'Edit collection'}</h2>
      <p className="sub">
        Manual collections hold fonts you add by hand. Smart collections update themselves from a rule.
      </p>

      <div className="card">
        <div className="card-head">
          <h3>Name</h3>
        </div>
        <input
          className="text-input"
          value={name}
          placeholder="e.g. Editorial serifs"
          onChange={(event) => setName(event.target.value)}
          autoFocus={isNew}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Type</h3>
          <div className="chip-row">
            <button className={`chip ${!smart ? 'on' : ''}`} onClick={() => setSmart(false)}>
              Manual
            </button>
            <button className={`chip ${smart ? 'on' : ''}`} onClick={() => setSmart(true)}>
              <Icon name="sparkle" size={12} /> Smart rule
            </button>
          </div>
        </div>

        {smart && (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Match
              </span>
              <button
                className={`chip ${match === 'all' ? 'on' : ''}`}
                onClick={() => setMatch('all')}
              >
                all
              </button>
              <button
                className={`chip ${match === 'any' ? 'on' : ''}`}
                onClick={() => setMatch('any')}
              >
                any
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                of the following
              </span>
            </div>

            {conditions.map((condition, index) => {
              const field = FIELDS.find((f) => f.value === condition.field) ?? FIELDS[0]
              return (
                <div className="condition" key={index}>
                  <select
                    value={condition.field}
                    onChange={(event) => {
                      const nextField = FIELDS.find((f) => f.value === event.target.value)!
                      patchCondition(index, { field: nextField.value, op: nextField.ops[0] })
                    }}
                  >
                    {FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={condition.op}
                    onChange={(event) => patchCondition(index, { op: event.target.value as ConditionOp })}
                  >
                    {field.ops.map((op) => (
                      <option key={op} value={op}>
                        {OP_LABEL[op]}
                      </option>
                    ))}
                  </select>

                  {needsValue(condition.op) ? (
                    <input
                      value={String(condition.value ?? '')}
                      onChange={(event) => patchCondition(index, { value: event.target.value })}
                      placeholder="value"
                    />
                  ) : (
                    <span />
                  )}

                  <button
                    className="icon-btn"
                    title="Remove condition"
                    onClick={() => setConditions(conditions.filter((_, i) => i !== index))}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              )
            })}

            <button
              className="btn sm"
              onClick={() =>
                setConditions([...conditions, { field: 'family', op: 'contains', value: '' }])
              }
            >
              <Icon name="plus" size={13} /> Add condition
            </button>
          </>
        )}

        <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
          {smart
            ? `${preview.toLocaleString()} faces match this rule right now.`
            : 'Add fonts to this collection from a font’s detail panel.'}
        </p>
      </div>

      <div className="row">
        <button className="btn primary" onClick={() => void save()}>
          <Icon name="check" size={14} /> Save collection
        </button>
        {!isNew && (
          <button
            className="btn danger"
            onClick={() => {
              void deleteCollection(collectionId)
              toast('Collection deleted')
            }}
          >
            <Icon name="trash" size={14} /> Delete
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => setView({ kind: 'library' })}>
          Cancel
        </button>
      </div>
    </div>
  )
}
