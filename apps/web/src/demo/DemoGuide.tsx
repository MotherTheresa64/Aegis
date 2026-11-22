import { useState } from 'react'
import { X } from 'lucide-react'

import { href } from '../lib/router'
import { DEMO_SEV1_INCIDENT } from './demoApi'

const KEY = 'aegis-demo-guide-hidden'

/** A short, real sequence through the product for first-time visitors of the demo. */
export function DemoGuide() {
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(KEY) === '1' } catch { return false }
  })
  if (hidden) return null
  function hide() {
    setHidden(true)
    try { sessionStorage.setItem(KEY, '1') } catch { /* Hidden for this render only. */ }
  }
  return (
    <section className="guide" aria-labelledby="guide-title">
      <header>
        <h2 id="guide-title">Try the response flow</h2>
        <button type="button" className="icon-button" aria-label="Hide guide" onClick={hide}><X size={16} /></button>
      </header>
      <ol>
        <li><a href={href({ page: 'incident', id: DEMO_SEV1_INCIDENT })}>Open the SEV1 incident</a>, post an update, then finish the rollback task.</li>
        <li>Move it through monitoring to resolved and watch Payments API recover on <a href={href({ page: 'services' })}>Services</a>.</li>
        <li>Draft the postmortem from the resolved incident’s timeline.</li>
        <li>Use <b>Simulate alert</b> above to open a new incident the way a monitoring tool would.</li>
        <li>Check <a href={href({ page: 'dependencies' })}>Dependencies</a> for what an outage puts at risk, and the <a href={href({ page: 'status' })}>status page</a> customers see.</li>
      </ol>
    </section>
  )
}

export function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <span><b>Demo workspace.</b> Sample data that resets when you close the tab.</span>
      <span className="demo-banner-links">
        <a href="https://github.com/MotherTheresa64/Aegis#local-development" target="_blank" rel="noreferrer">Run the full stack</a>
        <a href="/">Exit demo</a>
      </span>
    </div>
  )
}
