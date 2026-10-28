# -*- coding: utf-8 -*-
"""AMBER Build & Verification Report — body builder.

Reuses the validated dossier_body machinery (fonts, cascade palette, styles,
TocDocTemplate, two-phase build, page_deco) with report-specific content and
figures. Cover renders separately (html2poster.js) and merges via pypdf.
"""
import os, sys

BUILD_DIR = '/home/z/my-project/scripts/amber'
if BUILD_DIR not in sys.path:
    sys.path.insert(0, BUILD_DIR)

import dossier_body as db

# --- retitle the running module (page_deco reads these at call time) ---
db.DOC_TITLE = 'AMBER - Build & Verification Report'
db.DOC_AUTHOR = 'AMBER Build Guild - Z.ai'
db.OUT_BODY = os.path.join(BUILD_DIR, 'report_body.pdf')

from reportlab.platypus import Paragraph, Spacer, Image, CondPageBreak
from reportlab.lib.units import inch
from PIL import Image as PILImage

from report_content import R1
from report_content2 import R5, R8
from report_content3 import RL
from report_content4 import R12

ASSETS = '/home/z/my-project/download/amber_assets'


def build_story():
    story = []
    story.append(Paragraph('<b>Table of Contents</b>', db.S['toc_title']))
    toc = db.TableOfContents()
    toc.levelStyles = [db.TOC_L0, db.TOC_L1]
    story.append(toc)
    story.append(db.PageBreak())
    story.append(db.BodyStartMarker())
    # v1.2 chapter lands as its own part (7.5) between the invariants chapter
    # and the runbook chapter inside R8.
    _runbook_idx = next(i for i, blk in enumerate(R8) if blk[0] == 'h1' and 'Runbook' in blk[1])
    R8_HEAD, R8_TAIL = R8[:_runbook_idx], R8[_runbook_idx:]
    db.render_blocks(R1 + R5 + RL + R8_HEAD + R12 + R8_TAIL, story)
    # figures: block-level, evidence screenshots from the live session
    figures = [
        ('e2e_01_dashboard.png', 'Figure 9.1 - The live dashboard: key numbers, recent calls, pipeline snapshot, spend meter (browser session, 1440x900).'),
        ('e2e_02_call_overview.png', 'Figure 9.2 - The happy-path call at READY: summary, MEDDIC six-pack, arithmetic metrics (browser session).'),
        ('e2e_04_board.png', 'Figure 9.3 - The pipeline board after the live drag: Acme in QUALIFIED, health dot and risk badges per card.'),
        ('live/e2e_live_console.png', 'Figure 9.4 - The Live Console mid-session: recording indicator, meters (184 words, 5 questions, 5 cues, 01:05), the streaming transcript, and the cue stack with matched snippets - five battlecards fired during the demo dialogue.'),
        ('live/e2e_live_finalized_call.png', 'Figure 9.5 - The finalized live call: the same session after End & process, at READY with its transcript and analysis - the live layer and the post-call pipeline are one system.'),
        ('live/e2e_live_mobile.png', 'Figure 9.6 - The Live Console at 375px: single-column layout, no horizontal scroll, touch-sized controls.'),
        ('v12_login.png', 'Figure 9.7 - v1.2 front door: the login hero with warm radial wash, brand mark, one-line pitch and privacy trust chips.'),
        ('v12_dashboard.png', 'Figure 9.8 - v1.2 dashboard: greeting header, review-queue gradient banner, four icon KPI cards with count-up numbers, refined lists.'),
        ('v12_call_realai.png', 'Figure 9.9 - Real intelligence in the product: the TTS-synthesized discovery call at READY with 37 insights produced by glm-4.6 (browser session).'),
        ('v12_ask_library.png', 'Figure 9.10 - Ask the library answering a question with a grounded, cited response drawn from the call the system had just analyzed (T11 RAG on glm-4.6).'),
        ('v12_live_console.png', 'Figure 9.11 - The v1.2 live console mid-session: meters, streaming transcript, and the cue stack after the demo feed fired its battlecards.'),
        ('v12_settings.png', 'Figure 9.12 - v1.2 Settings providers tab: friendly provider cards with status dots, the ZAI routing toggle inline, and the cloud-STT egress disclosure card in warning tones.'),
    ]
    for path, caption in figures:
        img_path = os.path.join(ASSETS, path)
        if not os.path.exists(img_path):
            continue
        with PILImage.open(img_path) as im:
            w, h = im.size
        max_w = db.AVAIL_W
        max_h = 250
        scale = min(max_w / w, max_h / h, 1.0)
        img = Image(img_path, width=w * scale, height=h * scale)
        cap = Paragraph(caption, db.S['caption'])
        story.append(db.Spacer(1, 10))
        story.extend(db.safe_keep_together([img, db.Spacer(1, 6), cap]))
        story.append(db.Spacer(1, 14))
    return story


def _retitle(doc):
    doc.title = 'AMBER - Build & Verification Report: All Phases Implemented, Tested and Verified'
    doc.subject = ('Implementation and verification record for AMBER v1.2 + Live Assist: all 40 dossier work orders across P0-P5, '
                   'the 7-work-order real-time extension (WO-LA1..LA7), and the v1.2 real-intelligence + interface-elevation '
                   'delivery (bundled glm-4.6 provider, opt-in cloud STT, prompt pack v2, UI system) - FR-001..035 and NFR-01..14 '
                   'matrices, invariants (egress, crash safety, budget), golden-set calibration, sandbox adaptations, and the real-machine runbook.')
    return doc


def main():
    # Two-phase build identical to the dossier pipeline: phase A discovers the
    # true body-start page; phase B rebuilds with it fixed so footers and TOC
    # numbers agree on the roman/arabic boundary.
    doc = _retitle(db.make_doc())
    doc.multiBuild(build_story(), onFirstPage=db.page_deco, onLaterPages=db.page_deco)
    body_start = getattr(doc, '_body_start_page', None) or 2
    doc2 = _retitle(db.make_doc())
    doc2._body_start_page = body_start
    doc2._body_start_fixed = True
    doc2.multiBuild(build_story(), onFirstPage=db.page_deco, onLaterPages=db.page_deco)
    print('built', db.OUT_BODY, '| body starts at pdf page', body_start)


if __name__ == '__main__':
    main()
