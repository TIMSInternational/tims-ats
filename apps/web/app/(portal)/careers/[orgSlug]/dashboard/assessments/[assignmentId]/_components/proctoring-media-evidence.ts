import {
  confirmCandidateProctoringMedia,
  createCandidateProctoringMediaIntent,
  postCandidateProctoringMedia,
  type CandidateCaptureReason,
  type CandidateMediaType,
} from '../../../../../../../../lib/platform-api/proctoring';
import { PlatformApiError } from '../../../../../../../../lib/platform-api/client';
import { captureProctoringStill } from './proctoring-still';
import { hasLiveVideo, isEntireScreenShare, type ProctoringMedia } from './proctoring-media';

const PERIOD_MS = 65_000; // Above the server's rolling one-per-minute limit.
const FIRST_CAPTURE_DELAY_MS = 5_000;
const JITTER_MS = 10_000; // Desynchronize candidates starting an exam together.
const MAX_EVENT_STILLS_PER_TYPE = 5;
const MAX_PENDING_AGE_MS = 3 * 60_000;
const MAX_BUSY_RETRIES = 3;

interface CaptureJob {
  id: string;
  mediaType: CandidateMediaType;
  captureReason: CandidateCaptureReason;
  blob: Blob;
  createdAt: number;
  intentExpiresAt?: number;
}

export interface EvidenceState {
  active: boolean;
  uploading: boolean;
  failed: boolean;
  unavailable: boolean;
}

interface EvidenceDependencies {
  capture: typeof captureProctoringStill;
  createIntent: typeof createCandidateProctoringMediaIntent;
  post: typeof postCandidateProctoringMedia;
  confirm: typeof confirmCandidateProctoringMedia;
  newId: () => string;
  now: () => number;
  random: () => number;
}

const browserDependencies: EvidenceDependencies = {
  capture: captureProctoringStill,
  createIntent: createCandidateProctoringMediaIntent,
  post: postCandidateProctoringMedia,
  confirm: confirmCandidateProctoringMedia,
  newId: () => crypto.randomUUID(),
  now: () => Date.now(),
  random: () => Math.random(),
};

/** Browser-only capture scheduler. All media stays local until a signed S3 POST. */
export class CandidateMediaEvidenceController {
  private active = false;
  private media: ProctoringMedia;
  private abort = new AbortController();
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly retryTimers = new Map<CandidateMediaType, ReturnType<typeof setTimeout>>();
  private readonly busyRetries: Record<CandidateMediaType, number> = { camera: 0, screen: 0 };
  private readonly pending = new Map<CandidateMediaType, CaptureJob>();
  private readonly busy = new Set<CandidateMediaType>();
  private readonly eventCount: Record<CandidateMediaType, number> = { camera: 0, screen: 0 };
  private readonly lastPeriodic: Record<CandidateMediaType, number> = { camera: -Infinity, screen: -Infinity };
  private readonly failed = new Set<CandidateMediaType>();
  private readonly missing = new Set<CandidateMediaType>();

  constructor(
    private readonly route: { orgSlug: string; assignmentId: string },
    media: ProctoringMedia,
    private readonly onState: (state: EvidenceState) => void,
    private readonly deps: EvidenceDependencies = browserDependencies,
  ) {
    this.media = media;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.abort = new AbortController();
    this.publish();
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      if (!this.active) return;
      this.capturePeriodic();
      this.scheduleNextPeriodic();
    }, FIRST_CAPTURE_DELAY_MS + this.jitter());
  }

  private jitter(): number {
    return Math.floor(Math.max(0, Math.min(0.999, this.deps.random())) * JITTER_MS);
  }

  private scheduleNextPeriodic(): void {
    this.periodicTimer = setTimeout(() => {
      this.periodicTimer = null;
      if (!this.active) return;
      this.capturePeriodic();
      this.scheduleNextPeriodic();
    }, PERIOD_MS + this.jitter());
  }

  updateMedia(media: ProctoringMedia): void {
    this.media = media;
    if (hasLiveVideo(media.camera)) this.missing.delete('camera');
    if (hasLiveVideo(media.screen) && isEntireScreenShare(media.screen)) this.missing.delete('screen');
    this.publish();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.abort.abort();
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.periodicTimer) clearTimeout(this.periodicTimer);
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.busyRetries.camera = 0;
    this.busyRetries.screen = 0;
    this.initialTimer = null;
    this.periodicTimer = null;
    this.pending.clear();
    this.failed.clear();
    this.missing.clear();
    this.publish();
  }

  capturePeriodic(): void {
    void this.capture('camera', 'periodic');
    void this.capture('screen', 'periodic');
  }

  captureEvent(kind: CandidateMediaType): void {
    void this.capture(kind, 'event');
  }

  retry(): void {
    for (const kind of ['camera', 'screen'] as const) {
      if (this.failed.has(kind) || this.missing.has(kind))
        void this.capture(kind, this.pending.get(kind)?.captureReason ?? 'periodic');
    }
  }

  private publish(): void {
    this.onState({ active: this.active, uploading: this.active && this.busy.size > 0,
      failed: this.failed.size > 0, unavailable: this.missing.size > 0 });
  }

  private abandonExpiredJob(kind: CandidateMediaType): void {
    this.pending.delete(kind);
    this.lastPeriodic[kind] = -Infinity;
    this.busyRetries[kind] = 0;
    this.clearRetryTimer(kind);
  }

  private clearRetryTimer(kind: CandidateMediaType): void {
    const timer = this.retryTimers.get(kind);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(kind);
  }

  private scheduleBusyRetry(kind: CandidateMediaType, job: CaptureJob): void {
    if (!this.active || this.busyRetries[kind] >= MAX_BUSY_RETRIES) return;
    const attempt = this.busyRetries[kind] + 1;
    const delay = Math.min(2_000 * 2 ** (attempt - 1), 8_000) + this.jitter();
    const deadline = job.intentExpiresAt ?? job.createdAt + MAX_PENDING_AGE_MS;
    if (this.deps.now() + delay >= deadline) return;
    this.busyRetries[kind] = attempt;
    this.clearRetryTimer(kind);
    this.retryTimers.set(kind, setTimeout(() => {
      this.retryTimers.delete(kind);
      if (this.active && this.pending.get(kind) === job)
        void this.capture(kind, job.captureReason);
    }, delay));
  }

  private async capture(kind: CandidateMediaType, reason: CandidateCaptureReason): Promise<void> {
    if (!this.active || this.busy.has(kind)) return;
    let existing = this.pending.get(kind);
    if (existing && this.deps.now() >= (existing.intentExpiresAt ?? existing.createdAt + MAX_PENDING_AGE_MS)) {
      this.abandonExpiredJob(kind);
      existing = undefined;
      reason = 'periodic'; // Do not spend another event quota on an expired retry.
    }
    if (!existing) {
      const stream = this.media[kind];
      if (!hasLiveVideo(stream) || (kind === 'screen' && !isEntireScreenShare(stream))) {
        this.missing.add(kind);
        this.publish();
        return;
      }
      this.missing.delete(kind);
      if (reason === 'event' && this.eventCount[kind] >= MAX_EVENT_STILLS_PER_TYPE) return;
      if (reason === 'periodic') {
        const current = this.deps.now();
        if (current - this.lastPeriodic[kind] < PERIOD_MS) return;
        this.lastPeriodic[kind] = current;
      }
    }
    this.busy.add(kind);
    this.publish();
    try {
      let job = existing;
      if (!job) {
        const blob = await this.deps.capture(this.media, kind, this.abort.signal);
        if (!this.active) return;
        job = { id: this.deps.newId(), mediaType: kind, captureReason: reason,
          blob, createdAt: this.deps.now() };
        this.pending.set(kind, job);
        if (reason === 'event') this.eventCount[kind] += 1;
      }
      const intent = await this.deps.createIntent({
        ...this.route, clientCaptureId: job.id, mediaType: kind,
        captureReason: job.captureReason, contentType: 'image/jpeg',
      });
      if (!this.active) return;
      if (intent.status === 'intent') {
        job.intentExpiresAt = Date.parse(intent.intentExpiresAt);
        if (job.intentExpiresAt <= this.deps.now()) {
          this.abandonExpiredJob(kind);
          throw new Error('upload_grant_expired');
        }
        if (!intent.uploadUrl || !intent.uploadFields)
          throw new Error('upload_grant_unavailable');
        await this.deps.post(intent.uploadUrl, intent.uploadFields, job.blob, this.abort.signal);
        if (!this.active) return;
        const confirmed = await this.deps.confirm({ ...this.route, evidenceId: intent.evidenceId });
        if (!this.active) return;
        if (confirmed.status !== 'ready' || confirmed.evidenceId !== intent.evidenceId)
          throw new Error('media_confirm_unexpected');
      } else if (intent.status !== 'ready') {
        throw new Error('media_intent_unexpected');
      }
      this.pending.delete(kind);
      this.failed.delete(kind);
      this.busyRetries[kind] = 0;
      this.clearRetryTimer(kind);
    } catch (error) {
      if (this.active) {
        this.failed.add(kind);
        if (!this.pending.has(kind) && reason === 'periodic') this.lastPeriodic[kind] = -Infinity;
        if (error instanceof PlatformApiError && error.status === 429) {
          const job = this.pending.get(kind);
          if (job) this.scheduleBusyRetry(kind, job);
        }
      }
    } finally {
      this.busy.delete(kind);
      this.publish();
    }
  }
}
