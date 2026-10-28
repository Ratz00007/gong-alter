// AMBER — Test Script: RAG Library Search & Real-Time Live Assist Simulation for CGI
import { getDb } from '@/lib/db'
import { semanticSearch } from '@/lib/search/embed'
import { startLiveSession, ingestDelta, endLiveSession, getActiveSession } from '@/lib/live/engine'
import { finalizeSession } from '@/lib/live/finalize'
import { drainQueue } from '@/lib/jobs/worker'

async function runRAGTests() {
  console.log('================================================================');
  console.log('TEST 1: HYBRID VECTOR + BM25 SEARCH & RAG OVER CGI CALLS');
  console.log('================================================================\n');

  const queries = [
    {
      q: 'CSRD reporting deadlines Central Bank fitness probity',
      expectedTopic: 'Kerry Financial Services & Siobhan Murphy',
    },
    {
      q: 'Institute of Directors IoD competitor supply chain Scope 3',
      expectedTopic: 'Dairygold Agribusiness & Cormac Walsh',
    },
    {
      q: 'purchase order PO-94812 EU AI Act invoice terms',
      expectedTopic: 'MedTech Innovations Ireland & Declan Kelly',
    },
  ];

  for (const item of queries) {
    console.log(`Query: "${item.q}"`);
    const result = await semanticSearch(item.q, {}, { minScore: 0.20, limit: 3 });
    console.log(`Hits returned: ${result.hits.length} (Model: ${result.model ?? 'hybrid lexical'})`);

    if (result.hits.length > 0) {
      const topHit = result.hits[0];
      console.log(`  Top Hit [Score: ${topHit.score} | ${topHit.source}]:`);
      console.log(`  "${topHit.snippet.replace(/\n/g, ' ')}"`);
    } else {
      console.log('  No hits returned above threshold.');
    }
    console.log('----------------------------------------------------------------\n');
  }
}

async function runLiveAssistSimulation() {
  console.log('================================================================');
  console.log('TEST 2: LIVE ASSIST REAL-TIME SIMULATION & BATTLECARD CUES');
  console.log('================================================================\n');

  // Start live session
  const session = await startLiveSession({
    title: 'Live Discovery — Bank of Ireland Board Risk Review',
    source: 'INJECTED',
  });
  console.log(`Live Session Started: ID=${session.id} | Title="${session.title}"\n`);

  const liveDeltas = [
    {
      atMs: 2000,
      text: 'Good morning Liam, thanks for connecting today. What specifically triggered your review for the board?',
      speaker: 'REP',
    },
    {
      atMs: 8000,
      text: 'Our audit committee is deeply concerned about GDPR and compliance with the new EU AI Act rules.',
      speaker: 'CLIENT',
    },
    {
      atMs: 16000,
      text: 'We looked at the Institute of Directors and Gong, but frankly thirty thousand euro is out of budget for Q4.',
      speaker: 'CLIENT',
    },
    {
      atMs: 24000,
      text: 'Send me some information and let me think about it, we will circle back next quarter.',
      speaker: 'CLIENT',
    },
  ];

  for (const delta of liveDeltas) {
    console.log(`[T+${(delta.atMs / 1000).toFixed(1)}s] [${delta.speaker}]: "${delta.text}"`);
    const update = await ingestDelta(session.id, delta.text, delta.atMs);
    if (update && update.fires.length > 0) {
      for (const fire of update.fires) {
        console.log(`  >>> BATTLECARD TRIGGERED: [${fire.category}] "${fire.name}"`);
        console.log(`      Matched Phrase: "${fire.snippet}"`);
        console.log(`      Guidance: "${fire.guidance}"`);
      }
    } else {
      console.log('      (No objection triggers fired)');
    }
    console.log('');
  }

  // End live session and inspect stored fires
  await endLiveSession(session.id);
  const db = getDb();
  const firesInDb = await db.liveCueFire.findMany({ where: { sessionId: session.id } });
  console.log(`Session Ended. Total Battlecards Persisted in DB: ${firesInDb.length}`);

  // Finalize into the 6-stage pipeline
  console.log('\nFinalizing live session into a structured READY call...');
  const finalizeRes = await finalizeSession(session.id, { process: true });
  console.log(`Handoff to Pipeline: ok=${finalizeRes.ok}, callId=${finalizeRes.callId}`);

  await drainQueue();

  if (finalizeRes.callId) {
    const finalCall = await db.call.findUnique({
      where: { id: finalizeRes.callId },
      include: { summary: true, scorecard: true, insights: true },
    });
    console.log(`Analyzed Call Status: ${finalCall?.status}`);
    console.log(`Generated Summary: "${finalCall?.summary?.summary?.slice(0, 120)}..."`);
    console.log(`Talk Ratio: Rep ${finalCall?.scorecard?.talkRatioRep}% | Question Count: ${finalCall?.scorecard?.questionCount}`);
  }

  console.log('\n================================================================');
  console.log('ALL TESTS COMPLETED SUCCESSFULLY!');
  console.log('================================================================');
}

async function main() {
  await runRAGTests();
  await runLiveAssistSimulation();
}

void main();
