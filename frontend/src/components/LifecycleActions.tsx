import { useState } from 'react'
import { runOfficeAction, runOrganizationAction, type OrganizationStatus } from '../lib/api'
import { ConfirmActionModal } from './ConfirmActionModal'

type ActionKey = 'suspend' | 'reactivate' | 'terminate'

interface ActionDef {
  key: ActionKey
  label: string
  title: string
  confirmLabel: string
  danger: boolean
  description: string
}

const ORGANIZATION_ACTIONS: Record<ActionKey, ActionDef> = {
  suspend: {
    key: 'suspend',
    label: '利用停止',
    title: '法人の利用を停止します',
    confirmLabel: '利用停止を実行',
    danger: false,
    description:
      'この法人に所属するすべての事業所のスタッフが、ログインできなくなります。ログイン中のセッションも、次の操作で無効になります。停止は「利用再開」で解除できます。',
  },
  reactivate: {
    key: 'reactivate',
    label: '利用再開',
    title: '法人の利用を再開します',
    confirmLabel: '利用再開を実行',
    danger: false,
    description: 'この法人の停止を解除します。事業所が個別に停止されている場合、その事業所は停止のままです。',
  },
  terminate: {
    key: 'terminate',
    label: '契約終了',
    title: '法人の契約を終了します',
    confirmLabel: '契約終了を実行',
    danger: true,
    description:
      '契約を終了します。この操作は元に戻せません（終了後は利用再開もできません）。この法人のすべての事業所のスタッフが、ログインできなくなります。',
  },
}

const OFFICE_ACTIONS: Record<'suspend' | 'reactivate', ActionDef> = {
  suspend: {
    key: 'suspend',
    label: '利用停止',
    title: '事業所の利用を停止します',
    confirmLabel: '利用停止を実行',
    danger: false,
    description:
      'この事業所のスタッフが、ログインできなくなります。ログイン中のセッションも、次の操作で無効になります。法人と、他の事業所には影響しません。停止は「利用再開」で解除できます。',
  },
  reactivate: {
    key: 'reactivate',
    label: '利用再開',
    title: '事業所の利用を再開します',
    confirmLabel: '利用再開を実行',
    danger: false,
    description: 'この事業所の停止を解除します。法人が停止中・契約終了の場合は、法人の側が解除されるまで、ログインはできません。',
  },
}

// Which operations are offered for a target in a given (effective) status. A NULL status means a legacy
// record that needs review: only termination is offered for an organization (suspend / reactivate are
// refused by the database for it), nothing for an office.
function availableOrganizationActions(status: OrganizationStatus | null): ActionKey[] {
  if (status === 'active') return ['suspend', 'terminate']
  if (status === 'suspended') return ['reactivate', 'terminate']
  if (status === null) return ['terminate']
  return []
}

function availableOfficeActions(status: OrganizationStatus | null): ('suspend' | 'reactivate')[] {
  if (status === 'active') return ['suspend']
  if (status === 'suspended') return ['reactivate']
  return []
}

export function LifecycleActions({
  kind,
  id,
  name,
  status,
  onDone,
}: {
  kind: 'organization' | 'office'
  id: string
  name: string
  status: OrganizationStatus | null
  onDone: () => void
}) {
  const [active, setActive] = useState<ActionDef | null>(null)

  const defs: ActionDef[] =
    kind === 'organization'
      ? availableOrganizationActions(status).map((k) => ORGANIZATION_ACTIONS[k])
      : availableOfficeActions(status).map((k) => OFFICE_ACTIONS[k])

  if (defs.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {defs.map((def) => (
          <button
            key={def.key}
            type="button"
            onClick={() => setActive(def)}
            className={`rounded border px-2.5 py-1 text-xs font-medium ${
              def.danger ? 'border-red-300 text-red-700 hover:bg-red-50' : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {def.label}
          </button>
        ))}
      </div>

      {active && (
        <ConfirmActionModal
          title={active.title}
          targetKind={kind === 'organization' ? '法人' : '事業所'}
          targetName={name}
          description={active.description}
          confirmLabel={active.confirmLabel}
          danger={active.danger}
          onClose={() => setActive(null)}
          onConfirm={async ({ confirmName, reason }) => {
            if (kind === 'organization') {
              await runOrganizationAction(id, active.key, { confirmName, reason })
            } else {
              await runOfficeAction(id, active.key as 'suspend' | 'reactivate', { confirmName, reason })
            }
            setActive(null)
            onDone()
          }}
        />
      )}
    </>
  )
}
