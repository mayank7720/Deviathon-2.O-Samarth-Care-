"""Build the four-page DEV_104 submission. Requires reportlab and pypdf.

Run node scripts/evaluate-realistic.mjs first to refresh measured metrics, then:
    python scripts/build-writeup.py
The PDF is intentionally curated from docs/TECHNICAL_WRITEUP.md rather than a
blind Markdown printout. No network, external AI service or private data is used.
"""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Flowable
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
INK = colors.HexColor('#173B40')
TEAL = colors.HexColor('#167D79')
MUTED = colors.HexColor('#536A6D')
PAPER = colors.HexColor('#F0F6F4')
LINE = colors.HexColor('#DCE6E3')
GOLD = colors.HexColor('#D59B39')
FONT, BOLD = 'Helvetica', 'Helvetica-Bold'
font_root = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
if (font_root / 'segoeui.ttf').exists():
    pdfmetrics.registerFont(TTFont('CareSans', str(font_root / 'segoeui.ttf')))
    pdfmetrics.registerFont(TTFont('CareSans-Bold', str(font_root / 'segoeuib.ttf')))
    pdfmetrics.registerFontFamily('CareSans', normal='CareSans', bold='CareSans-Bold', italic='CareSans', boldItalic='CareSans-Bold')
    FONT, BOLD = 'CareSans', 'CareSans-Bold'

STYLES = {
    'body': ParagraphStyle('body', fontName=FONT, fontSize=9.45, leading=13.7, textColor=INK, spaceAfter=7),
    'small': ParagraphStyle('small', fontName=FONT, fontSize=8.15, leading=11.4, textColor=MUTED, spaceAfter=5),
    'heading': ParagraphStyle('heading', fontName=BOLD, fontSize=15.5, leading=20, textColor=INK, spaceBefore=8, spaceAfter=8),
    'sub': ParagraphStyle('sub', fontName=BOLD, fontSize=10.5, leading=14, textColor=TEAL, spaceBefore=6, spaceAfter=5),
    'label': ParagraphStyle('label', fontName=BOLD, fontSize=8.5, leading=12, textColor=TEAL, spaceAfter=7),
    'title': ParagraphStyle('title', fontName=BOLD, fontSize=32, leading=37, textColor=INK, spaceAfter=11),
    'deck': ParagraphStyle('deck', fontName=FONT, fontSize=12, leading=17, textColor=MUTED, spaceAfter=13),
    'table': ParagraphStyle('table', fontName=FONT, fontSize=8.6, leading=12, textColor=INK),
    'th': ParagraphStyle('th', fontName=BOLD, fontSize=8.2, leading=11.7, textColor=colors.white),
    'metric': ParagraphStyle('metric', fontName=BOLD, fontSize=25, leading=29, textColor=TEAL),
}

def p(text, style='body'):
    return Paragraph(text, STYLES[style])

def section(number, title, subtitle):
    return [p(f'{number} / TECHNICAL DESIGN', 'label'), p(title, 'heading'), p(subtitle, 'small')]

def table(headers, rows, widths):
    data = [[p(escape(str(value)), 'th') for value in headers]]
    data += [[p(str(value), 'table') for value in row] for row in rows]
    result = Table(data, colWidths=widths, hAlign='LEFT', repeatRows=1)
    result.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), TEAL),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PAPER]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 9),
        ('RIGHTPADDING', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LINEBELOW', (0, -1), (-1, -1), .6, LINE),
    ]))
    return result

def callout(title, text):
    result = Table([[p(title, 'sub')], [p(text, 'body')]], colWidths=[499])
    result.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), PAPER), ('BOX', (0, 0), (-1, -1), .6, LINE), ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12), ('TOPPADDING', (0, 0), (-1, 0), 3), ('BOTTOMPADDING', (0, -1), (-1, -1), 6)]))
    return result

class Architecture(Flowable):
    def __init__(self):
        super().__init__(); self.width=499; self.height=127
    def draw(self):
        c=self.canv
        nodes=[(0,71,108,'Signals','Vitals / medicines','Hindi-English notes'),(131,71,108,'Local analysis','Personal rules','Isolation Forest'),(262,71,108,'Daily triage','Reasons / urgency','Unknown when sparse'),(393,71,106,'Human action','Coordinator review','Outcome / feedback')]
        for x,y,w,title,a,b in nodes:
            c.setFillColor(PAPER);c.setStrokeColor(LINE);c.roundRect(x,y,w,53,5,fill=1,stroke=1)
            c.setFillColor(INK);c.setFont(BOLD,9);c.drawString(x+8,y+36,title)
            c.setFillColor(MUTED);c.setFont(FONT,7.2);c.drawString(x+8,y+22,a);c.drawString(x+8,y+11,b)
        c.setStrokeColor(TEAL);c.setLineWidth(1)
        for x in [112,243,374]:
            c.line(x,96,x+14,96);c.line(x+14,96,x+10,99);c.line(x+14,96,x+10,93)
        c.setFillColor(INK);c.setFont(BOLD,8.8);c.drawString(0,47,'Verified identity + fresh role / senior scope + consent checks')
        c.setFillColor(MUTED);c.setFont(FONT,8.2);c.drawString(0,29,'React/Vinext mobile interface  |  Worker API  |  D1 locally or Supabase Postgres / RLS')
        c.drawString(0,13,'Persistent signals, daily scores, alert state, tasks, communications, outbox and audit trail')

class LeadTime(Flowable):
    def __init__(self):super().__init__();self.width=499;self.height=91
    def draw(self):
        c=self.canv
        for y,label,fraction,colour,count in [(62,'Human review, score 30+',.6,TEAL,'48 / 80 days'),(29,'High priority, score 60+',.2,GOLD,'16 / 80 days')]:
            c.setFillColor(INK);c.setFont(BOLD,8.4);c.drawString(0,y+7,label)
            c.setFillColor(LINE);c.roundRect(174,y,249,15,3,fill=1,stroke=0)
            c.setFillColor(colour);c.roundRect(174,y,249*fraction,15,3,fill=1,stroke=0)
            c.setFillColor(INK);c.setFont(BOLD,8.1);c.drawRightString(499,y+4,count)
        c.setFillColor(MUTED);c.setFont(FONT,7.7);c.drawString(0,7,'Coverage of authored scenario-days only. Neither bar is a clinical recall or diagnostic accuracy.')

def furniture(canvas, doc):
    width,height=A4
    canvas.setStrokeColor(LINE);canvas.setLineWidth(.5);canvas.line(48, height-43, width-48, height-43)
    canvas.setFillColor(TEAL);canvas.setFont(BOLD,8);canvas.drawString(48,height-31,'SAMARTH CARE')
    canvas.setFillColor(MUTED);canvas.setFont(FONT,7.5);canvas.drawRightString(width-48,height-31,'DEV_104  /  DEVIATHON SHOWCASE')
    canvas.line(48,44,width-48,44)
    canvas.setFont(FONT,7.1);canvas.drawString(48,30,'Synthetic demonstration. Human review required. No diagnosis or treatment advice.')
    canvas.setFont(BOLD,7.7);canvas.drawRightString(width-48,30,f'{doc.page} / 4')

def build(output, render=False):
    source=(ROOT/'docs/TECHNICAL_WRITEUP.md').read_text(encoding='utf-8-sig')
    for expected in ['17,226','60.0%','20.0%','3.75','Not established']:
        if expected not in source:raise ValueError(f'Technical write-up changed; reconcile PDF narrative: {expected}')
    metrics_path=ROOT/'outputs/realistic-evaluation.json'
    if not metrics_path.exists():raise ValueError('Run node scripts/evaluate-realistic.mjs before building the current PDF.')
    report=json.loads(metrics_path.read_text(encoding='utf-8'))
    metrics=report['metrics'];review=metrics['scenarioReviewCoverage']
    assert report['metadata']['actualObservations']==17226
    assert (review['coveredDays'],review['scenarioDays'],review['detectedCases'],review['totalCases'])==(48,80,4,4)
    assert review['meanOnsetDetectionDelayDays']==3.75 and metrics['recall']==.2 and metrics['precision'] is None
    assert metrics['detectedCases']==3 and metrics['unlabelledHighSeniorDays']==49
    story=[]
    story += [p('EARLY WARNING FOR SENIORS LIVING AT HOME','label'),p('Samarth Care','title'),p('Who needs attention today,<br/>why, and what should happen next?','deck')]
    story += [p('A mobile-accessible care workspace joins personal-baseline rules, anomaly detection and Hindi/English check-ins. Recorded evidence leads to a human follow-up. The system does not diagnose a senior or recommend changing medicines.')]
    story += [Architecture(),p('Four roles, one accountable care loop','sub')]
    story += [table(['Role','Assigned experience'],[
        ['Care coordinator','Urgency-first queue, source evidence and next step; record observations, acknowledge alerts and document outcomes.'],
        ['Senior','Simple Hindi/English check-in or assisted ordinary call; gentle responses without condition labels.'],
        ['Family member','Linked, consented view; reviewed weekly updates and serious change notices.'],
        ['Operations manager','Read-only alert volume, recorded response latency, task completion and city/team views.'],
    ],[110,389]),Spacer(1,9)]
    story += [callout('A complete path from signal to review','Structured vitals, medication logs and dated call notes feed shared language extraction and daily scoring. Immediate concerns lead the queue; incomplete support stays unknown. Saved fact snapshots support traceable reports and coordinator-reviewed family delivery.')]
    story += [Spacer(1,5),p('React 19 / Vinext, Worker API, local D1 fixtures and Supabase Auth/Postgres/RLS. A selected replay or live India-time clock controls freshness. All showcase profiles and historical observations are fictional; a public landing does not expose care records.','small')]
    story += [PageBreak()]

    story += section('02','Realistic data without invented provenance','Reference-informed synthetic observations; explicit authored assumptions and checks, not an observed patient cohort.')
    story += [table(['Cohort property','Construction and limits'],[
        ['200 seniors x 90 days','Seed 1042026; 18,000 possible senior-days and 17,226 observed records. The configured end date sets the calendar window.'],
        ['External aggregate reference [1]','MITRE Synthea April 2020 CSV: observation ages 60-110; 296 synthetic identity medians for BP/weight and 220 for glucose. Archive hash recorded.'],
        ['Observation process','Serially correlated trajectories; modality-specific schedules; 4.3% whole-check-in gaps; unknown medicine logs remain missing.'],
        ['16 authored review scenarios','Multi-signal, medication, appetite and mobility changes, including gradual recovery. Four single dated fall incidents. The 8% mix is not prevalence.'],
    ],[126,373]),Spacer(1,8)]
    story += [p('What is measured, what is assumed','sub'),p('Synthea is synthetic US EHR data, not representative Indian geriatric or independent home-care outcomes data. Daily noise, serial correlation, symptom wording, medicine-taking, schedules and recovery are authored assumptions. Compatible SpO2 reference data is unavailable. Every generated record retains its synthetic origin; evaluation labels are separate from clinical and report inputs.')]
    story += [p('Notes agree with dose logs; individual dose statuses sum to daily counts. A fall is reported once instead of recurring in every note. Weight changes gradually through recovery. Checks find invalid dates, duplicates, implausible input, pressure-order errors, dose mismatches, conflicting text and abrupt weight changes. The default cohort has zero hard inconsistencies; passing does not validate health outcomes.')]
    story += [p('Personal rules plus an actual anomaly model [2]','sub'),p('A local Isolation Forest uses <b>48 trees, subsamples of 128 and nine features</b>. It fits 2,099 rolling three-day vectors from first-30-day observations of 150 development identities. Fifty identities are held out from forest fitting and retain their own first-30-day reference. Rules and model use no scenario labels.')]
    story += [callout('Unknown means a fresh check-in is needed','Score 60+ is high, 30-59 medium, when evidence is sufficient. Shared triage puts immediate concerns first. Sparse support and baseline warm-up return a null score; serious observed evidence remains visible. Illustrative thresholds and anomaly scores are not disease probabilities.')]
    story += [p('Shared Hindi / English / Hinglish rules extract dated cues with bounded negation and subject checks. Complex paraphrase or attribution can fail. Nine-domain analysis, logged missed-dose patterns and a three-day descriptive score projection support verification, not diagnosis.','small')]
    story += [PageBreak()]

    story += section('03','Evidence you can inspect and reproduce','Partial synthetic annotations expose model limits. A grounded report cannot invent a reading, diagnosis, call or outcome.')
    cards=Table([[p('60.0%','metric'),p('4 / 4','metric'),p('3.75 days','metric')],[p('SCENARIO-DAY REVIEW','label'),p('SCENARIOS REVIEWED','label'),p('AFTER AUTHORED ONSET','label')]],colWidths=[166,166,167])
    cards.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PAPER),('TOPPADDING',(0,0),(-1,0),12),('BOTTOMPADDING',(0,-1),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),12)]))
    story += [cards,Spacer(1,9),p('Fifty held-out identities include four authored scenarios. Days 31-90 provide 3,000 evaluated senior-days, of which 80 have positive review annotations. Other days are unlabelled, not confirmed healthy. Clinical precision, specificity, recall and F1 cannot be estimated from these data.')]
    story += [LeadTime(),table(['Measure','Existing threshold 30','Existing threshold 60'],[
        ['Covered scenario-days','48 / 80 (60.0%)','16 / 80 (20.0%)'],
        ['Authored cases detected','4 of 4','3 of 4'],
        ['Mean onset-to-first-flag delay','3.75 days','6.0 days'],
    ],[171,164,164]),Spacer(1,7)]
    story += [p('There are <b>49 high flags on unlabelled days</b>, not automatically false alarms. Rules-only high coverage is 10.0%, versus 20.0% with the anomaly model. Three seeds give 20.0-31.3% high scenario-day coverage. No held-out threshold retuning was performed. Legacy 93.7% precision does not transfer to this cohort.','small')]
    story += [p('Evidence-locked weekly reports','sub'),p('A saved, dated snapshot computes coverage, valid measurements, units, personal comparisons and source aliases. Local mode renders English/Hindi facts without an LLM. Configured n8n receives masked aggregates and an allowed schema; its model selects existing fact IDs and a warm presentation. The server renders verified sentences, rejecting invented values, free prose, unknown facts, missing coverage, omitted immediate concerns or weaker follow-up.')]
    story += [p('Valid results show model/provider provenance. Unavailable or invalid output becomes a visibly labelled computed report, never a fabricated AI success. HMAC signatures, durable nonces, job expiry and an evidence hash bind callbacks. Raw notes, direct identity and original record IDs stay in the care store. Masked derived health data remains sensitive. All reports are review drafts before family delivery.','small')]
    story += [PageBreak()]

    story += section('04','Stretch goals, privacy and working boundaries','Implemented paths must be distinguished from credential configuration, provider acceptance and real device verification.')
    story += [table(['Stretch capability','Implemented path and acceptance boundary'],[
        ['Hindi voice check-in','Four questions, saved structured answers and coordinator follow-up. Live provider/SIM paths require verified contacts, consent, configuration and actual answer evidence.'],
        ['LLM family summary','Evidence-locked n8n model selection with explicit provider/model status; local computed alternative. Coordinator approval and current sharing consent precede delivery.'],
        ['Fall / inactivity','Permissioned foreground phone-motion aggregates and unconfirmed impact/orientation/quiet candidates. A still phone is not proof of senior inactivity.'],
        ['Coordinator feedback','A separate usefulness classifier requires sufficient balanced labels and identity-group holdout. It never lowers care urgency.'],
        ['Medicine patterns','Logged missed-dose days/times and duplicate schedules. No medication-interaction database or treatment recommendation is claimed.'],
    ],[122,377]),Spacer(1,7)]
    story += [p('Privacy and accountable action [3]','sub'),p('Verified identity, fresh role/senior scope and consent protect each request. User sessions stay in HttpOnly cookies; normal database calls use the publishable key plus caller token. RLS blocks family access to raw events and staff scores. A separate privately authenticated background processor handles daily work. Revocation and sharing withdrawal block subsequent access.')]
    story += [p('Outbox identities deduplicate work; delivery leases reduce concurrent sends. Provider acceptance differs from delivery or a human read. Generic opt-in push contains no health detail. Real browser audio [4] needs explicit microphone permission, two authorized participants and compatible networking. A signed assisted-call boundary does not itself dial a phone.')]
    story += [callout('Free for a showcase is not unlimited carrier service','n8n orchestrates; a provider credit or existing SIM still carries a real call/SMS. The current delivery checkpoint states what was actually connected and tested. No queued, accepted or simulated status is represented as a completed call. Free quotas and 10,000-person cost/throughput need separate measurement.')]
    story += [p('Reproduce: <b>node scripts/evaluate-realistic.mjs</b> exports current quality, scenarios and metrics; <b>npm test</b> checks behavior. Governed outcomes, expert adjudication, accessibility/alert-fatigue field studies and clinical/operational review remain necessary before real care use.','small')]
    story += [p('References and provenance','sub'),p('[1] Walonoski et al., <i>Synthea</i>, JAMIA 2018: <link href="https://doi.org/10.1093/jamia/ocx079" color="#167D79">doi:10.1093/jamia/ocx079</link>; <link href="https://synthetichealth.github.io/downloads.html" color="#167D79">official aggregate source</link>. [2] Liu et al., <i>Isolation Forest</i>, ICDM 2008: <link href="https://doi.org/10.1109/ICDM.2008.17" color="#167D79">doi:10.1109/ICDM.2008.17</link>.','small'),p('[3] Supabase <link href="https://supabase.com/docs/guides/database/postgres/row-level-security" color="#167D79">RLS</link> and <link href="https://supabase.com/docs/guides/database/vault" color="#167D79">Vault</link>. [4] W3C <link href="https://www.w3.org/TR/webrtc/" color="#167D79">WebRTC</link>. Methods: docs/TECHNICAL_WRITEUP.md and DATA_REALISM.md. Edition: 29 October 2026.','small')]
    output.parent.mkdir(parents=True,exist_ok=True)
    document=SimpleDocTemplate(str(output),pagesize=A4,rightMargin=48,leftMargin=48,topMargin=60,bottomMargin=58,title='Samarth Care - Current DEV_104 Technical Write-up',author='Samarth Care',subject='Reference-informed synthetic care data and evidence-locked reporting',pageCompression=1)
    document.build(story,onFirstPage=furniture,onLaterPages=furniture)
    reader=PdfReader(str(output))
    assert len(reader.pages)==4,f'Expected four pages, got {len(reader.pages)}'
    extracted='\n'.join(page.extract_text() for page in reader.pages)
    for expected in ['60.0%','20.0%','17,226','3.75 days','49 high flags','evidence-locked']:
        assert expected.lower() in extracted.lower(),f'Missing current report evidence: {expected}'
    print(f'Built {output} ({len(reader.pages)} pages)')
    if render:
        poppler=shutil.which('pdftoppm')
        if not poppler:
            runtime=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe'
            if runtime.exists():poppler=str(runtime)
        if not poppler:raise RuntimeError('Install Poppler or put pdftoppm on PATH to render for visual verification.')
        preview=ROOT/'outputs/pdf-qa/writeup';preview.parent.mkdir(parents=True,exist_ok=True)
        subprocess.run([poppler,'-scale-to','1450','-png',str(output),str(preview)],check=True)
        print(f'Rendered pages under {preview.parent}')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'docs/Samarth-Care-Technical-Writeup.pdf')
    parser.add_argument('--render',action='store_true')
    args=parser.parse_args();build(args.output,args.render)
