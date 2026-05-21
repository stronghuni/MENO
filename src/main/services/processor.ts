import { getMeeting, updateMeeting } from './storage'
import { transcribeWav, isModelInstalled } from './transcriber'
import { diarizeWav, isDiarizationInstalled } from './diarizer'
import { isLlmInstalled, summarize } from './summarizer'
import { extractAttendees, extractTags } from '../domain/prompts'
import { mergeTranscriptWithDiarization } from '../domain/merger'
import { broadcast as send } from './broadcaster'
import { hasSecret } from './keychain'
import { loadSettings } from './settings'
import { uploadMeeting } from './notion'
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
    let segments = await transcribeWav(audioPath, ({ segment }) => {
      partial.push(segment)
      broadcast({
        meetingId,
        stage: 'transcribing',
        message: `전사 중… (${partial.length}개 세그먼트)`,
        partialSegments: partial.slice()
      })
    })

    if (isDiarizationInstalled()) {
      broadcast({ meetingId, stage: 'diarizing', message: '화자 분리 중…' })
      try {
        const diarization = await diarizeWav(audioPath)
        segments = mergeTranscriptWithDiarization(segments, diarization)
      } catch (e) {
        console.warn('Diarization failed, continuing without speaker labels:', e)
      }
    }

    // Respect any attendee list the user typed in the new-meeting form.
    // Only fall back to whatever the diarizer surfaces when the field is
    // empty — overwriting user input would be confusing.
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

    broadcast({ meetingId, stage: 'done', partialSegments: segments })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    broadcast({ meetingId, stage: 'error', message })
  }
}
