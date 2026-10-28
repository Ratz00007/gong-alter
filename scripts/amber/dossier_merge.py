# -*- coding: utf-8 -*-
"""Merge cover (Playwright) + body (ReportLab) into the final AMBER Build Dossier PDF.
Normalizes every page to exact A4 per report.md (Playwright px->pt drift fix)."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89
BUILD = '/home/z/my-project/scripts/amber'
OUT = '/home/z/my-project/download/AMBER_Complete_Build_Dossier.pdf'

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
        '/Title': 'AMBER - The Complete Build Dossier: Full Documentation Suite v2.0',
        '/Author': 'Z.ai',
        '/Creator': 'Z.ai',
        '/Subject': 'Complete build documentation for a personal, hybrid (local + cloud) revenue intelligence platform: gap audit, PRD, functional spec, data dictionary, API spec, AI engine and prompts, UX screens, security, testing, operations, configuration, and 40 work orders.',
    })
    with open(output_pdf, 'wb') as f:
        writer.write(f)
    print('merged ->', output_pdf)

if __name__ == '__main__':
    insert_cover(f'{BUILD}/cover_dossier.pdf', f'{BUILD}/dossier_body.pdf', OUT)
