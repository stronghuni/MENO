import { getMeeting, updateMeeting } from './storage'
import { transcribeWavChunked, isModelInstalled } from './transcriber'
import { isLlmInstalled, summarize } from './summarizer'
import { extractAttendees, extractTags } from '../domain/prompts'
import { broadcast as send } from './broadcaster'
import { hasSecret } from './keychain'
import { loadSettings } from './settings'
import { uploadMeeting } from './notion'
import { exportActionItems } from './jira'
import { indexMeeting } from './graph'
import { extractNextMeeting } from './nextMeeting'
import { createEvent } from './storage'
import type { ProcessingStatus, TranscriptSegment } from '../../shared/types'

const active = new Map<string, ProcessingStatus>()

function broadcast(status: ProcessingStatus): void {
  active.set(status.meetingId, status)
  send('processing:update', status)
}

export function getProcessingStatus(meetingId: string): ProcessingStatus | null {
  return active.get(meetingId) ?? null
}

export async function processRecording(meetingId: string, audioPath: string): Promise<void> {
  if (!isModelInstalled()) {
    broadcast({
      meetingId,
      stage: 'error',
      message: 'Whisper 모델이 설치되지 않았습니다. 설정 화면에서 다운로드하세요.'
    })
    return
  }

  try {
    broadcast({ meetingId, stage: 'transcribing', message: '한국어 전사 중…' })
    const partial: TranscriptSegment[] = []
    const segments = await transcribeWavChunked(
      audioPath,
      (segment, count) => {
        partial.push(segment)
        broadcast({
          meetingId,
          stage: 'transcribing',
          message: `전사 중… (${count}개 세그먼트)`,
          partialSegments: partial.slice()
        })
      },
      (p) => {
        // After every chunk: persist what we have so a crash mid-pipeline
        // doesn't lose the work. The user opens the meeting later and
        // sees whatever was committed up to the point of failure.
        updateMeeting(meetingId, {
          transcriptJson: JSON.stringify(p.accumulatedSegments)
        })
        const startMin = Math.floor(p.chunkStartSec / 60)
        const endMin = Math.ceil(p.chunkEndSec / 60)
        const msg =
          p.totalChunks > 1
            ? `전사 ${p.chunkIdx}/${p.totalChunks} (${startMin}~${endMin}분) — ${p.accumulatedSegments.length}개 세그먼트`
            : `전사 중… (${p.accumulatedSegments.length}개 세그먼트)`
        broadcast({
          meetingId,
          stage: 'transcribing',
          message: msg,
          partialSegments: p.accumulatedSegments
        })
      }
    )

    // Speaker diarization was removed — onnxruntime 1.24 KleidiAI crash.
    // Attendee list comes from the user's new-meeting form; if they
    // skipped the field we fall back to whatever speaker labels the
    // segments carry (currently always null, since diarization is off).
    const existing = getMeeting(meetingId)
    const userAttendees: string[] = existing?.attendeesJson
      ? (JSON.parse(existing.attendeesJson) as string[])
      : []
    const finalAttendees =
      userAttendees.length > 0 ? userAttendees : extractAttendees(segments)
    updateMeeting(meetingId, {
      transcriptJson: JSON.stringify(segments),
      attendeesJson:
        finalAttendees.length > 0 ? JSON.stringify(finalAttendees) : null
    })

    // Guard against hallucinated notes from a trivially short transcript.
    // A 7B model handed a near-empty transcript ("안녕하세요") plus our
    // full section template will confabulate an entire fake meeting
    // (invented speakers, agenda, decisions). Below a minimum amount of
    // real transcript text we skip summarization entirely and leave an
    // honest note instead.
    //
    // Measure UNIQUE content, not raw length: Whisper loops on near-silence
    // and emits the same line ("안녕하세요") dozens of times, which clears a
    // raw-character gate while carrying zero real information. Dedup the
    // segment texts before counting so repetitive junk is caught too.
    const transcriptChars = [...new Set(segments.map((s) => s.text.trim()))].join('').length
    const MIN_SUMMARY_CHARS = 40
    if (transcriptChars < MIN_SUMMARY_CHARS) {
      updateMeeting(meetingId, {
        notesMd:
          '전사된 내용이 충분하지 않아 회의록을 생성하지 않았습니다. (녹음이 너무 짧거나 음성이 거의 없었습니다.)',
        tagsJson: null
      })
      broadcast({
        meetingId,
        stage: 'done',
        message: '전사 내용이 부족하여 회의록을 생성하지 않았습니다.',
        partialSegments: segments
      })
      return
    }

    if (isLlmInstalled()) {
      broadcast({ meetingId, stage: 'summarizing', message: '회의록 작성 중…' })
      try {
        const meeting = getMeeting(meetingId)
        if (meeting) {
          const rawNotes = await summarize(
            meeting.title,
            meeting.startedAt,
            meeting.durationMs,
            segments,
            finalAttendees,
            (p) => {
              const msg =
                p.stage === 'chunk'
                  ? `긴 회의 — 구간 요약 중 (${p.current}/${p.total})…`
                  : '최종 회의록 통합 중…'
              broadcast({ meetingId, stage: 'summarizing', message: msg })
            }
          )
          const { tags, cleanedNotes } = extractTags(rawNotes)
          updateMeeting(meetingId, {
            notesMd: cleanedNotes,
            tagsJson: tags.length > 0 ? JSON.stringify(tags) : null
          })
        }
      } catch (e) {
        console.warn('Summarization failed:', e)
        broadcast({
          meetingId,
          stage: 'error',
          message: `요약 실패: ${e instanceof Error ? e.message : String(e)}`,
          partialSegments: segments
        })
        return
      }
    }

    // ── Auto-upload to Notion ───────────────────────────────────────────
    // Triggers only when (a) the user opted in (default), (b) a token sits
    // in Keychain, and (c) a default database is picked. Any failure here
    // is non-fatal — the notes are already saved locally and the user can
    // retry from the meeting detail UI.
    const settings = loadSettings()
    const meetingAfterSummary = getMeeting(meetingId)
    if (
      settings.autoUploadToNotion &&
      settings.notionParentId &&
      meetingAfterSummary?.notesMd &&
      (await hasSecret('notion.token'))
    ) {
      broadcast({ meetingId, stage: 'uploading', message: 'Notion에 업로드 중…' })
      try {
        await uploadMeeting(meetingId)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.warn('Auto-upload to Notion failed:', message)
        broadcast({
          meetingId,
          stage: 'done',
          message: `자동 업로드 실패 (수동으로 재시도 가능): ${message}`,
          partialSegments: segments
        })
        return
      }
    }

    // ── Auto-export action items to Jira ─────────────────────────────────
    // Same opt-in shape as Notion: only fires when the user enabled it and
    // Jira is fully configured. Non-fatal — notes stay local and the user
    // can retry from the meeting detail "Jira로 보내기" button.
    if (
      settings.autoExportToJira &&
      settings.jiraSiteUrl &&
      settings.jiraEmail &&
      settings.jiraProjectKey &&
      meetingAfterSummary?.notesMd &&
      (await hasSecret('jira.token'))
    ) {
      broadcast({ meetingId, stage: 'uploading', message: 'Jira에 액션 아이템 전송 중…' })
      try {
        await exportActionItems(meetingId)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.warn('Auto-export to Jira failed:', message)
        // Non-fatal: fall through to done. The user can retry manually.
      }
    }

    // ── Index into the relationship graph ───────────────────────────────
    // Fold attendees + tags + an LLM pass over the notes into the meeting
    // graph so it shows up in "관련 회의". Non-fatal — purely additive.
    try {
      await indexMeeting(meetingId, { llm: true })
    } catch (e) {
      console.warn('Graph indexing failed:', e)
    }

    // ── Auto-register the next meeting on the calendar ───────────────────
    // If the notes name a concrete follow-up date, drop it on the calendar
    // (tagged auto, linked to this meeting). Non-fatal; users can delete.
    try {
      const m = getMeeting(meetingId)
      if (m?.notesMd) {
        const next = await extractNextMeeting(m.notesMd, new Date(m.startedAt), m.title)
        if (next) {
          createEvent({
            title: next.title,
            scheduledAt: next.scheduledAt,
            projectId: m.projectId,
            sourceMeetingId: meetingId,
            auto: true
          })
        }
      }
    } catch (e) {
      console.warn('Next-meeting auto-register failed:', e)
    }

    broadcast({ meetingId, stage: 'done', partialSegments: segments })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    broadcast({ meetingId, stage: 'error', message })
  }
}
