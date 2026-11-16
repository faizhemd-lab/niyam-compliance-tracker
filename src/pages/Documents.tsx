import { Download, FileText, FolderOpen, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { groupFiles } from '../shared/documents'
import type { GeneratedFile } from '../shared/types'
import { downloadZip } from '../shared/zip'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, EmptyState } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Footer } from '../components/Footer'
import { Modal, useToast } from '../components/Overlay'

export function Documents() {
  useDocumentTitle('Documents')
  const { state, deadlines } = useTracker()
  const toast = useToast()
  const [open, setOpen] = useState<GeneratedFile | null>(null)
  const groups = groupFiles(state.generated)
  const years = [...new Set(state.generated.map((f) => f.path.split('/')[0]))]

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="Document compiler"
        title="Your filing folders"
        intro="Each deadline compiles its own folder: drafts filled from the company record, a checklist and a manifest. Folder names carry the deadline date so they sort in the order work is due."
        actions={
          <>
            <ButtonLink to="/calendar" variant="ghost" size="sm">
              Open a deadline
            </ButtonLink>
            <Button
              variant="violet"
              size="sm"
              disabled={!state.generated.length}
              icon={<Download className="size-4" />}
              onClick={() => {
                downloadZip(`compliance-${years[0] ?? 'year'}.zip`, state.generated)
                toast('Downloaded. Every file is marked DRAFT, review before use.')
              }}
            >
              Download all
            </Button>
          </>
        }
      >
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Badge tone="violet">{state.generated.length} files</Badge>
          {years.map((y) => (
            <Badge key={y} tone="outline">
              {y}
            </Badge>
          ))}
          <span className="text-[12.5px] text-muted">Drafts only — the government forms are filed on official portals.</span>
        </div>
      </PageHead>

      {!state.generated.length ? (
        <Card className="mt-2">
          <EmptyState
            title="Nothing compiled yet"
            body="Open any deadline and choose Compile drafts. The compiler fills the templates it can, lists the fields it is missing, and files everything under the financial year."
            action={
              deadlines.length ? (
                <ButtonLink to={`/deadline/${encodeURIComponent(deadlines[0].id)}`} variant="violet" icon={<Sparkles className="size-4" />}>
                  Compile the next deadline
                </ButtonLink>
              ) : (
                <ButtonLink to="/agent" variant="violet">
                  Ask the agent what applies
                </ButtonLink>
              )
            }
          />
        </Card>
      ) : (
        <div className="mt-2 grid gap-2">
          {groups.map((group) => {
            const [fy, heading, folder] = group.dir.split('/')
            return (
              <Card as="section" key={group.dir} className="px-5 py-5 sm:px-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="caps text-muted">
                      {fy} / {heading}
                    </p>
                    <h2 className="mt-1 flex items-center gap-2 text-[16px] font-medium tracking-[-0.02em]">
                      <FolderOpen className="size-4 text-violet" aria-hidden />
                      {folder ?? group.dir}
                    </h2>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<Download className="size-4" />}
                    onClick={() => {
                      downloadZip(`${folder ?? 'folder'}.zip`, group.files)
                      toast('Folder downloaded.')
                    }}
                  >
                    Download folder
                  </Button>
                </div>
                <ul className="mt-4 divide-y divide-line border-y border-line">
                  {group.files.map((file) => (
                    <li key={file.path} className="flex items-center gap-3 py-2.5">
                      <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                      <button type="button" onClick={() => setOpen(file)} className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium hov:text-violet">
                        {file.name}
                      </button>
                      <span className="hidden shrink-0 text-[11.5px] text-muted sm:inline">{file.media}</span>
                      <span className="shrink-0 rounded-full bg-soft px-2 py-0.5 text-[11px] text-muted">DRAFT</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          })}
        </div>
      )}

      <Card as="section" tone="soft" className="mt-2 px-5 py-5 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="caps mb-1 text-muted">What is generated</p>
            <p className="text-[13.5px] leading-relaxed">Board resolutions, AGM notices, director KYC sheets, employee master, GST data and an authority letter.</p>
          </div>
          <div>
            <p className="caps mb-1 text-muted">What is not</p>
            <p className="text-[13.5px] leading-relaxed">The government forms themselves. Filing stays with you or your CA, on the official portal.</p>
          </div>
          <div>
            <p className="caps mb-1 text-muted">Every folder carries</p>
            <p className="text-[13.5px] leading-relaxed">
              A <code className="rounded bg-card px-1">_checklist.html</code>, a <code className="rounded bg-card px-1">_manifest.json</code> and the DRAFT mark on every file.
            </p>
          </div>
        </div>
      </Card>

      <p className="px-3 py-2 text-[12.5px] text-muted">
        Missing a document?{' '}
        <Link to="/import" className="text-violet hov:underline">
          Import your company data
        </Link>{' '}
        and the compiler fills more of the template next time.
      </p>

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.name ?? 'Document'} description={open?.path} className="sm:max-w-3xl">
        <pre className="max-h-[60svh] overflow-auto rounded-[var(--radius-control)] bg-soft p-4 text-[12px] leading-relaxed whitespace-pre-wrap">{open?.content}</pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="violet"
            size="sm"
            icon={<Download className="size-4" />}
            onClick={() => {
              if (!open) return
              downloadZip(open.name.replace(/\s+/g, '-') + '.zip', [open])
              toast('Downloaded with the DRAFT mark intact.')
            }}
          >
            Download this file
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
            Close
          </Button>
        </div>
      </Modal>

      <Footer />
    </Shell>
  )
}
