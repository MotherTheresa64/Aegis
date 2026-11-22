import { Copy, ExternalLink } from 'lucide-react'

import { useClient } from '../client'
import { useConsole } from '../console/context'
import { PublicStatusView } from '../public/PublicStatusView'
import { useFeedback } from '../ui/Feedback'
import { useResource } from '../ui/hooks'
import { ErrorState, Loading, PageHeader } from '../ui/Layout'

export function StatusPreviewPage() {
  const { client, demo } = useClient()
  const { membership, revision } = useConsole()
  const { toast } = useFeedback()
  const slug = membership.organization.slug
  const { data, error, reload } = useResource(() => client.publicStatus(slug), `${slug}:${revision}`)
  const url = `${window.location.origin}/status/${slug}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast('Status page link copied')
    } catch {
      toast('Copy failed – select the link and copy it manually', 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Status page"
        description={<>What customers see at <code>/status/{slug}</code>. It updates from service status and open incidents; internal notes never appear.</>}
        actions={!demo && (
          <>
            <button type="button" className="button" onClick={copy}><Copy size={15} />Copy link</button>
            <a className="button" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open</a>
          </>
        )}
      />
      {error ? <ErrorState message={error} retry={reload} /> : !data ? <Loading /> : (
        <div className="status-frame"><PublicStatusView data={data} /></div>
      )}
    </>
  )
}
