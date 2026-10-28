// AMBER — pipeline job handler registration (worker import site).
import { registerJobHandler } from '../jobs/worker'
import { handleNormalize, handleTranscribe, handleAnalyze, handleIndex, retryCall, reanalyzeCall } from './orchestrator'
import { runReindexAll } from './index'
import { runEvalSuite } from '../eval/harness'

registerJobHandler('NORMALIZE', (job) => handleNormalize(job.callId))
registerJobHandler('TRANSCRIBE', (job) => handleTranscribe(job.callId))
registerJobHandler('ANALYZE', (job) => handleAnalyze(job.callId))
registerJobHandler('INDEX', (job) => handleIndex(job.callId))
registerJobHandler('REINDEX', async () => {
  await runReindexAll()
})
registerJobHandler('EVAL', async () => {
  await runEvalSuite()
})

export { retryCall, reanalyzeCall }
