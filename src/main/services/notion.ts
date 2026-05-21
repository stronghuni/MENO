import { Client } from '@notionhq/client'
import { markdownToBlocks } from '@tryfabric/martian'
import { getSecret } from './keychain'
import { loadSettings } from './settings'
import { getMeeting, updateMeeting } from './storage'
import type { NotionTarget } from '../../shared/types'

const CHILD_BATCH = 100

async function client(): Promise<Client> {
  const token = await getSecret('notion.token')
  if (!token) throw new Error('Notion 토큰이 설정되어 있지 않습니다.')
  return new Client({ auth: token })
}

interface RawTitleRun {
  plain_text?: string
}

interface RawPageHit {
  object: string
  id: string
  url?: string
  archived?: boolean
  in_trash?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties?: Record<string, any>
}

function extractPageTitle(page: RawPageHit): string {
  // Notion pages expose the title in `properties.<TitleProp>.title[]`.
  // Database rows use whatever the title column is named; standalone
  // pages always have `properties.title.title[]`. We iterate to find
  // the first property whose type is "title".
  const props = page.properties ?? {}
  for (const value of Object.values(props)) {
    if (value?.type === 'title' && Array.isArray(value.title)) {
      const text = (value.title as RawTitleRun[])
        .map((t) => t.plain_text ?? '')
        .join('')
        .trim()
      if (text) return text
    }
  }
  return '제목 없음'
}

/**
 * List every page the Integration is shared into. The user picks one of
 * these as the parent for future uploads — each meeting note then lands
 * as a child page underneath. Pages inside databases are filtered out
 * (a database row isn't a great parent for free-form sub-pages).
 */
export async function searchTargets(): Promise<NotionTarget[]> {
  const notion = await client()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = notion.search as any
  const res = (await search({
    filter: { property: 'object', value: 'page' },
    page_size: 100,
    sort: { direction: 'descending', timestamp: 'last_edited_time' }
  })) as { results: RawPageHit[] }

  return res.results
    .filter((p) => p.object === 'page' && !p.archived && !p.in_trash)
    .map((p) => ({
      id: p.id,
      title: extractPageTitle(p),
      url: p.url ?? ''
    }))
}

/**
 * Backwards-compatible alias. Existing renderer imports call this name.
 */
export const searchDatabases = searchTargets

export async function uploadMeeting(meetingId: string): Promise<{ url: string }> {
  const meeting = getMeeting(meetingId)
  if (!meeting) throw new Error(`회의 ${meetingId}를 찾을 수 없습니다.`)
  if (!meeting.notesMd) throw new Error('아직 회의록이 작성되지 않았습니다.')

  const { notionParentId } = loadSettings()
  if (!notionParentId) throw new Error('업로드할 부모 페이지가 설정되지 않았습니다.')

  const notion = await client()
  const blocks = markdownToBlocks(meeting.notesMd)
  const firstBatch = blocks.slice(0, CHILD_BATCH)
  const restBatches: (typeof blocks)[] = []
  for (let i = CHILD_BATCH; i < blocks.length; i += CHILD_BATCH) {
    restBatches.push(blocks.slice(i, i + CHILD_BATCH))
  }

  // A page-parent create only needs a title property. We don't have a
  // schema to map against here, which keeps onboarding trivial — the
  // user just shared a page with the Integration and we're good.
  const created = (await notion.pages.create({
    parent: { page_id: notionParentId },
    properties: {
      title: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        title: [{ text: { content: meeting.title } }] as any
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children: firstBatch as any
  })) as { id: string; url: string }

  for (const batch of restBatches) {
    await notion.blocks.children.append({
      block_id: created.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      children: batch as any
    })
  }

  updateMeeting(meetingId, {
    notionPageUrl: created.url,
    notionUploadedAt: Date.now()
  })

  return { url: created.url }
}
