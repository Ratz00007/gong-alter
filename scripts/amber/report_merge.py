# -*- coding: utf-8 -*-
"""Merge cover (Playwright) + body (ReportLab) into the AMBER Build &
Verification Report PDF. Same A4 normalization as the dossier pipeline."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89
BUILD = '/home/z/my-project/scripts/amber'
OUT = '/home/z/my-project/download/AMBER_Build_Verification_Report.pdf'


def normalize_page_to_a4(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page


def insert_cover(cover_pdf, body_pdf, output_pdf):
    writer = PdfWriter()
    cover_page = PdfReader(cover_pdf).pages[0]
    writer.add_page(normalize_page_to_a4(cover_page))
    for page in PdfReader(body_pdf).pages:
        writer.add_page(normalize_page_to_a4(page))
    writer.add_metadata({
        '/Title': 'AMBER - Build & Verification Report: All Phases Implemented, Tested and Verified',
        '/Author': 'Z.ai',
        '/Creator': 'Z.ai',
        '/Subject': ('Implementation and verification record for AMBER v1.2 + Live Assist: 57 work orders '
                     '(40 dossier + 7 live + 10 v1.2 real-intelligence/interface), FR-001..035 and NFR-01..014 matrices, invariants, '
                     'golden-set calibration, sandbox adaptations, and the real-machine runbook.'),
    })
    with open(output_pdf, 'wb') as f:
        writer.write(f)
    print('merged ->', output_pdf, '| pages:', 1 + len(PdfReader(body_pdf).pages))


if __name__ == '__main__':
    insert_cover(f'{BUILD}/cover_report.pdf', f'{BUILD}/report_body.pdf', OUT)
