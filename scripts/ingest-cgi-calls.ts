// AMBER — Ingestion Script: The Corporate Governance Institute (Dublin, Ireland)
// Realistic enterprise sales call dataset across Discovery, Proposal/Negotiation, and Closing.
import { getDb } from '@/lib/db'
import { storeAsset, storeScript } from '@/lib/media/vault'
import { intakeCall, handleNormalize, handleTranscribe, handleAnalyze, handleIndex } from '@/lib/pipeline/orchestrator'
import { logDealEvent } from '@/lib/timeline/assemble'
import { recomputeDealHealth } from '@/lib/health/formula'
import { createPureWavBuffer } from '../tests/helpers'

interface CallSpec {
  account: string
  dealTitle: string
  stage: 'QUALIFIED' | 'PROPOSAL' | 'WON'
  valueCents: number
  contactName: string
  contactTitle: string
  contactEmail: string
  isChampion: boolean
  isEconomicBuyer: boolean
  callTitle: string
  nextStep: string
  daysAgo: number
  segments: { speaker: 'SPEAKER_00' | 'SPEAKER_01'; startMs: number; endMs: number; text: string }[]
}

const CGI_CALLS: CallSpec[] = [
  // ---------------- Call 1: Kerry Financial Services (Discovery / Qualification) ----------------
  {
    account: 'Kerry Financial Services',
    dealTitle: 'Kerry Financial — Board Governance & CSRD Upskilling',
    stage: 'QUALIFIED',
    valueCents: 2450000, // €24,500
    contactName: 'Siobhan Murphy',
    contactTitle: 'Group Company Secretary & Head of Legal',
    contactEmail: 'siobhan.murphy@kerryfinancial.ie',
    isChampion: true,
    isEconomicBuyer: false,
    callTitle: 'Discovery — Central Bank Probity & Board CSRD Readiness',
    nextStep: 'Send EduQual syllabus and cohort timetable for Nominations Committee review by Thursday',
    daysAgo: 4,
    segments: [
      {
        speaker: 'SPEAKER_00', // Liam O'Connor (CGI Advisory Lead)
        startMs: 0,
        endMs: 4200,
        text: 'Good morning Siobhan, Liam here from The Corporate Governance Institute in Dublin. Thanks for making time today.',
      },
      {
        speaker: 'SPEAKER_01', // Siobhan Murphy (Company Sec)
        startMs: 4600,
        endMs: 9800,
        text: 'Good morning Liam. Glad we could connect. We are under a bit of pressure ahead of our next board cycle, so the timing is quite good.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 10400,
        endMs: 16200,
        text: 'I understand completely. What specifically triggered you reaching out to us regarding your board education and governance diplomas?',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 16800,
        endMs: 27500,
        text: 'Well, two key drivers. First, the Central Bank of Ireland has noticeably tightened scrutiny around fitness and probity reviews for our non-executive directors. Second, our upcoming CSRD reporting deadlines next March.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 28200,
        endMs: 33500,
        text: 'How many non-executive directors are currently sitting on the board, and how prepared are they for the CSRD technical disclosures?',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 34100,
        endMs: 47200,
        text: 'We have six NEDs. Individually, they are brilliant commercial and financial leaders, but candidly, none of them have formal certifications in ESG governance or double materiality oversight. Our audit committee chair was very blunt about that exposure.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 48000,
        endMs: 57400,
        text: 'That is the exact gap our Diploma in Corporate Governance and ESG was structured to solve. How does the board handle learning commitments given their existing board obligations?',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 58000,
        endMs: 69200,
        text: 'That is our primary constraint. They sit on multiple boards across Dublin and London. They cannot attend full-day classroom seminars. It has to be asynchronous digital modules paired with concentrated, high-impact sessions.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 70000,
        endMs: 82500,
        text: 'Our platform is entirely micro-learning online, accessible on mobile or tablet, backed by live Dublin-based masterclasses with former regulators. They can complete the accreditation in four to six months on their own schedule.',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 83100,
        endMs: 92400,
        text: 'That is exactly the structure we need. What does the investment look like for a cohort of six directors including accreditation fees?',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 93000,
        endMs: 104500,
        text: 'For a dedicated cohort of six, including the EduQual certified diploma and direct examiner feedback, the enterprise rate is twenty-four thousand five hundred euro total.',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 105200,
        endMs: 116800,
        text: 'That sits well within our executive development allocation. Who signs off? The Chair of Nominations and our Chief Executive. If you send me the syllabus, I will table it at our committee meeting Thursday.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 117500,
        endMs: 125000,
        text: 'Fantastic. I will send the syllabus, regulatory mapping, and cohort schedule by two o\'clock today. Let us lock in a follow-up for Friday morning.',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 125600,
        endMs: 130000,
        text: 'Perfect Liam. Speak with you Friday at ten. Thanks very much.',
      },
    ],
  },

  // ---------------- Call 2: Dairygold Agribusiness plc (Proposal & Objection Handling) ----------------
  {
    account: 'Dairygold Agribusiness plc',
    dealTitle: 'Dairygold plc — 8-Director ESG Diploma Cohort',
    stage: 'PROPOSAL',
    valueCents: 3160000, // €31,600
    contactName: 'Cormac Walsh',
    contactTitle: 'Chief Risk Officer & Chair of Governance Committee',
    contactEmail: 'cormac.walsh@dairygold.ie',
    isChampion: false,
    isEconomicBuyer: true,
    callTitle: 'Proposal Review — IoD Comparison & Enterprise Tiering',
    nextStep: 'Deliver revised proposal with split invoice terms and custom ag-sector CSRD case studies by Wednesday',
    daysAgo: 2,
    segments: [
      {
        speaker: 'SPEAKER_00', // Liam O'Connor (CGI Advisory Lead)
        startMs: 0,
        endMs: 4500,
        text: 'Hello Cormac, good afternoon. Hope you are keeping well down in Cork.',
      },
      {
        speaker: 'SPEAKER_01', // Cormac Walsh (CRO)
        startMs: 5000,
        endMs: 10800,
        text: 'Afternoon Liam. All good here, thanks. I have reviewed the proposal you sent through for our eight directors.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 11400,
        endMs: 17200,
        text: 'Great. What were your key impressions from the ESG Governance syllabus and corporate cohort structure?',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 17800,
        endMs: 31000,
        text: 'The curriculum is spot on, especially the supply chain Scope 3 governance module. But I need to be transparent with you—we are also in discussions with the Institute of Directors Ireland, and their brand is very well entrenched with our board.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 31800,
        endMs: 44000,
        text: 'The IoD is an admirable traditional institution. Where clients consistently choose CGI over the IoD is modern governance agility. Did the IoD offer specific ESG double materiality and supply chain compliance modules?',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 44600,
        endMs: 56500,
        text: 'No, to be fair to you, their chartered director program is much more generalist. CGI has much deeper technical depth on European CSRD and regulatory compliance for agribusiness.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 57200,
        endMs: 64000,
        text: 'And in terms of format, can your eight directors afford to take full working days out of their schedules for classroom lectures in Dublin?',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 64600,
        endMs: 76000,
        text: 'No, that was our biggest sticking point with the IoD. Our directors are located across Munster and Dublin; travel days are simply unworkable. CGI’s digital platform is substantially more practical.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 76800,
        endMs: 82500,
        text: 'That makes complete sense. What about the commercial proposal of thirty-one thousand six hundred euro for the eight seats?',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 83200,
        endMs: 96000,
        text: 'The price is on the high side for our Q4 budget. If we can split the payment across two fiscal years or get tailored agribusiness ESG case studies included, I can get this signed by the CFO.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 96800,
        endMs: 108500,
        text: 'We can structure fifty percent on enrolment in November and fifty percent in January, and our academic director will include our dairy sector CSRD benchmark pack at no additional cost.',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 109200,
        endMs: 119500,
        text: 'That solves my budget constraint. Update the proposal with those payment milestones, send it to me Wednesday, and I will submit it for final board approval.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 120200,
        endMs: 125000,
        text: 'You will have the updated agreement in your inbox by tomorrow afternoon, Cormac. Thanks again.',
      },
    ],
  },

  // ---------------- Call 3: MedTech Innovations Ireland (Closing & Procurement) ----------------
  {
    account: 'MedTech Innovations Ireland',
    dealTitle: 'MedTech Ireland — AI Governance Board Certification',
    stage: 'WON',
    valueCents: 1920000, // €19,200
    contactName: 'Declan Kelly',
    contactTitle: 'Chief People Officer & Board Advisor',
    contactEmail: 'declan.kelly@medtechinnovations.ie',
    isChampion: true,
    isEconomicBuyer: true,
    callTitle: 'Final Agreement — AI Governance Cohort & Kickoff Schedule',
    nextStep: 'Distribute director onboarding credentials and calendar kickoff webinar for November 12th',
    daysAgo: 1,
    segments: [
      {
        speaker: 'SPEAKER_00', // Ciara Dunne (CGI Enterprise Director)
        startMs: 0,
        endMs: 4000,
        text: 'Declan, lovely to speak with you again. Trust you had a pleasant weekend.',
      },
      {
        speaker: 'SPEAKER_01', // Declan Kelly (CPO)
        startMs: 4500,
        endMs: 10200,
        text: 'Hi Ciara, yes, very good thank you. Delighted to say we have completed our legal and procurement review on the CGI agreement.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 10800,
        endMs: 15500,
        text: 'That is wonderful news. Did the procurement team have any remaining questions on the data processing addendum?',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 16100,
        endMs: 27800,
        text: 'None at all. Your Irish hosting and GDPR compliance assurances satisfied our data protection officer completely. The purchase order number has been generated: PO-94812.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 28500,
        endMs: 34500,
        text: 'Super. To confirm, this covers the ten participants across the executive committee and board for the AI & Cyber Governance Certificate?',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 35100,
        endMs: 46800,
        text: 'Yes, exactly ten. Our CEO, CTO, and eight board members. With the EU AI Act coming into force, the board wanted formal oversight qualifications before our next audit.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 47500,
        endMs: 56000,
        text: 'The timing could not be better. The total is nineteen thousand two hundred euro. We will issue the invoice against PO-94812 with thirty-day terms.',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 56600,
        endMs: 65200,
        text: 'Perfect. When can our directors expect their portal access and orientation details?',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 65800,
        endMs: 77500,
        text: 'Our student experience team will dispatch individualized welcome packs and login credentials on Thursday. We have our live cohort kickoff webinar set for Tuesday, November twelfth at four pm.',
      },
      {
        speaker: 'SPEAKER_01',
        startMs: 78100,
        endMs: 87500,
        text: 'That works brilliantly with our board diary. I will send over the participant roster right after this call. Pleasure doing business with CGI, Ciara.',
      },
      {
        speaker: 'SPEAKER_00',
        startMs: 88100,
        endMs: 94000,
        text: 'Likewise Declan. We are thrilled to partner with MedTech Innovations Ireland. Have a great day.',
      },
    ],
  },
]

async function main() {
  const db = getDb()
  console.log('Ingesting The Corporate Governance Institute (Dublin, Ireland) realistic sales calls...\n')

  for (const c of CGI_CALLS) {
    console.log(`Processing: ${c.account} - "${c.callTitle}"`)

    // 1. Create or update Deal
    const deal = await db.deal.create({
      data: {
        title: c.dealTitle,
        account: c.account,
        stage: c.stage,
        valueCents: c.valueCents,
        currency: 'EUR',
        nextStep: c.nextStep,
        nextStepDueAt: new Date(Date.now() + 7 * 86400_000),
        expectedCloseAt: new Date(Date.now() + 30 * 86400_000),
      },
    })

    // 2. Create Contact
    const contact = await db.contact.create({
      data: {
        dealId: deal.id,
        name: c.contactName,
        title: c.contactTitle,
        email: c.contactEmail,
        isChampion: c.isChampion,
        isEconomicBuyer: c.isEconomicBuyer,
      },
    })

    // 3. Synthesize audio buffer matching the duration
    const totalDurationMs = c.segments[c.segments.length - 1].endMs + 2000
    const durationSec = Math.ceil(totalDurationMs / 1000)
    const wavBytes = createPureWavBuffer(durationSec, 330)
    const { asset } = await storeAsset(wavBytes, 'audio/wav', `${c.account.replace(/\s+/g, '_')}_call.wav`)

    // 4. Create Call record via intakeCall
    const occurredAt = new Date(Date.now() - c.daysAgo * 86400_000)
    const call = await intakeCall({
      title: c.callTitle,
      dealId: deal.id,
      contactId: contact.id,
      occurredAt,
      mediaAssetId: asset.id,
      audioSha256: asset.sha256,
    })

    // 5. Store sidecar script for the scripted STT binding
    const scriptPayload = {
      language: 'en',
      segments: c.segments.map((s, idx) => ({
        idx,
        speaker: s.speaker,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
      })),
    }
    storeScript(call.id, JSON.stringify(scriptPayload))

    // 6. Drive the 6-stage pipeline to completion
    await handleNormalize(call.id)
    await handleTranscribe(call.id)
    await handleAnalyze(call.id)
    await handleIndex(call.id)

    // 7. Update deal health and timeline event
    await logDealEvent(deal.id, 'CALL_ANALYZED', { callId: call.id, title: call.title, stage: c.stage }, occurredAt)
    await recomputeDealHealth(deal.id)

    console.log(`  -> Call ${call.id.slice(-6)}: READY (Deal: ${c.stage}, Value: €${(c.valueCents / 100).toLocaleString()})`)
  }

  console.log('\nAll 3 The Corporate Governance Institute sales calls successfully ingested and analyzed!')
}

void main()
