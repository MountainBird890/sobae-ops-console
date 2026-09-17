import { useEffect, useState } from 'react'

// beforeinstallprompt is a browser-specific event with no type in lib.dom.d.ts.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIOSDevice(userAgent: string): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent)
}

function isStandaloneDisplay(): boolean {
  const mediaStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  // navigator.standalone is iOS Safari's non-standard equivalent.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return mediaStandalone || iosStandalone
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [standalone, setStandalone] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setStandalone(isStandaloneDisplay())

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    function handleAppInstalled() {
      setInstallEvent(null)
      setStandalone(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  async function handleInstallClick() {
    if (!installEvent) return
    await installEvent.prompt()
    await installEvent.userChoice
    // The prompt can only be used once.
    setInstallEvent(null)
  }

  if (standalone || dismissed) return null

  const isIOS = isIOSDevice(window.navigator.userAgent)
  // Nothing to offer: no native prompt available, and not iOS (where the
  // instructions below are the only way to install).
  if (!installEvent && !isIOS) return null

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[#020c45] bg-[#020c45]/5 px-3.5 py-2.5 text-sm text-slate-900">
      {installEvent ? (
        <>
          <span>ホーム画面に追加すると、アプリのように起動できます。</span>
          <button
            type="button"
            onClick={handleInstallClick}
            className="cursor-pointer whitespace-nowrap rounded-md bg-[#020c45] px-3 py-1.5 font-bold text-white"
          >
            ホーム画面に追加
          </button>
        </>
      ) : (
        <span>
          Safariの共有メニューから「ホーム画面に追加」を選ぶと、アプリのように起動できます。
        </span>
      )}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="閉じる"
        className="cursor-pointer p-0.5 text-base leading-none text-slate-500"
      >
        ×
      </button>
    </div>
  )
}
