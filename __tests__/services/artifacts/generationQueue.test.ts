import { describe, expect, it } from 'vitest';
import { cancelGenerationJob, changeGenerationJob, countInterrupted, retryGenerationJob, runnableJobs, type GenerationJob } from '../../../services/artifacts/application/generationQueue';

const job = (id: string, priority = 0): GenerationJob => ({ id, projectId: 'p', artifactName: id, priority, enqueuedAt: Number(id), status: 'queued' });

describe('generation queue', () => {
  it('fills three slots by priority, then starts the next job after a completion or error', () => {
    const initial = [job('1'), job('2', 2), job('3', 1), job('4')];
    expect(runnableJobs(initial).map(item => item.id)).toEqual(['2', '3', '1']);
    const running = ['2', '3', '1'].reduce((jobs, id) => changeGenerationJob(jobs, id, { status: 'running' }), initial);
    expect(runnableJobs(running)).toEqual([]);
    expect(runnableJobs(changeGenerationJob(running, '2', { status: 'failed' })).map(item => item.id)).toEqual(['4']);
  });

  it('cancels only unfinished jobs and retries only failures', () => {
    const running = changeGenerationJob([job('1'), job('2')], '1', { status: 'running' });
    const cancelled = cancelGenerationJob(running, '1', 100);
    expect(cancelled[0]).toMatchObject({ status: 'cancelled', finishedAt: 100 });
    expect(countInterrupted(cancelled)).toBe(1);
    expect(retryGenerationJob(cancelled, '1', 200)[0].status).toBe('cancelled');
    const failed = changeGenerationJob(cancelled, '2', { status: 'failed', failure: { headline: 'x', message: 'x', detail: 'x', retryable: true } });
    expect(retryGenerationJob(failed, '2', 200)[1]).toMatchObject({ status: 'queued', enqueuedAt: 200, failure: undefined });
  });
});
