/** Export only the selected summary, never internal reviewer notes or contacts. */
export function reportExportText(subjectName,report,status,createdLabel){
 return [subjectName+' · Weekly wellbeing summary',
  [report.period?.from,report.period?.to].filter(Boolean).join(' — '),
  status+' · '+(report.generation?.llmUsed?'AI-generated summary':'Recorded-data summary'),'',report.text||'',
  '',`Generated ${createdLabel}. Family sharing requires care-team review.`].join('\n');
}
