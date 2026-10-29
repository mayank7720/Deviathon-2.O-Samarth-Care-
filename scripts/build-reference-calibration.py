"""Aggregate a public, synthetic Synthea sample; never imports patient identities.

The archive is downloaded from MITRE's official sample-data mirror and retained
only under ignored outputs/reference/. Only per-person aggregate distributions
are committed. These distributions are calibration context, not validation of
clinical risk labels or representation of Indian older adults.
"""
from pathlib import Path
import csv
import hashlib
import io
import json
import statistics
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://synthetichealth.github.io/synthea-sample-data/downloads/synthea_sample_data_csv_apr2020.zip'
DESTINATION = ROOT / 'data/reference/synthea-calibration.json'
CODES = {'8480-6': 'systolic', '8462-4': 'diastolic', '2339-0': 'glucose', '2345-7': 'glucose', '29463-7': 'weight', '20564-1': 'spo2', '59408-5': 'spo2'}
EXPECTED_UNITS = {'systolic': {'mm[Hg]'}, 'diastolic': {'mm[Hg]'}, 'glucose': {'mg/dL'}, 'weight': {'kg'}, 'spo2': {'%'}}

def quantile(values, fraction):
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lower = int(index)
    return ordered[lower] + (ordered[min(lower+1, len(ordered)-1)] - ordered[lower]) * (index-lower)

def main():
    raw_path = ROOT / 'outputs/reference/synthea_sample_data_csv_apr2020.zip'
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    if not raw_path.exists():
        with urllib.request.urlopen(URL, timeout=90) as response:
            data = response.read(20_000_001)
        if len(data) > 20_000_000:
            raise ValueError('Reference archive exceeds the expected bounded size.')
        raw_path.write_bytes(data)
    archive_bytes = raw_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        def rows(filename):
            matches = [name for name in archive.namelist() if name.rsplit('/', 1)[-1] == filename]
            if len(matches) != 1:
                raise ValueError(f'Expected one {filename} file.')
            return csv.DictReader(io.TextIOWrapper(archive.open(matches[0]), encoding='utf-8-sig'))
        patients = {row['Id']: row for row in rows('patients.csv')}
        grouped = {key: {} for key in EXPECTED_UNITS}
        counts = {key: 0 for key in EXPECTED_UNITS}
        rejected_units = {key: 0 for key in EXPECTED_UNITS}
        for row in rows('observations.csv'):
            key = CODES.get(row.get('CODE'))
            if not key or row.get('PATIENT') not in patients:
                continue
            patient = patients[row['PATIENT']]
            try:
                observed = row['DATE'][:10]
                born = patient['BIRTHDATE']
                age = int(observed[:4])-int(born[:4])-(observed[5:] < born[5:])
                value = float(row['VALUE'])
            except (ValueError, KeyError):
                continue
            if not 60 <= age <= 110:
                continue
            if row.get('UNITS') not in EXPECTED_UNITS[key]:
                rejected_units[key] += 1
                continue
            grouped[key].setdefault(row['PATIENT'], []).append(value)
            counts[key] += 1
        distributions = {}
        for key, people in grouped.items():
            values = [statistics.median(observations) for observations in people.values()]
            if not values:
                distributions[key] = {'available': False, 'reason': 'No compatible observations in this reference archive.'}
                continue
            distributions[key] = {'available': True, 'people': len(values), 'observations': counts[key], 'unit': next(iter(EXPECTED_UNITS[key])), 'p10': round(quantile(values,.1),2), 'median': round(statistics.median(values),2), 'p90': round(quantile(values,.9),2), 'minimum': round(min(values),2), 'maximum': round(max(values),2), 'aggregation': 'One median per synthetic identity at observation age 60-110; distribution across identity medians.'}
        result = {'schemaVersion': 1, 'source': {'title': 'MITRE Synthea April 2020 sample CSV', 'url': URL, 'documentation': 'https://synthetichealth.github.io/downloads.html', 'paper': 'https://doi.org/10.1093/jamia/ocx079', 'archiveSha256': hashlib.sha256(archive_bytes).hexdigest(), 'archiveBytes': len(archive_bytes), 'synthetic': True, 'allSampleIdentities': len(patients), 'reuse': 'Official download page states data is free from cost, privacy and security restrictions.'}, 'population': 'US synthetic sample; observations at ages 60-110. Not an Indian geriatric cohort.', 'distributions': distributions, 'rejectedUnitCounts': rejected_units, 'limitations': ['This is an externally authored synthetic reference, not observed patient data.', 'No decline labels, predictive validation, diagnostic accuracy or population prevalence are inferred from this archive.', 'Daily autocorrelation, observation scheduling, symptoms, medication-taking and fall events in Samarth Care are explicitly authored simulation assumptions.', 'Unavailable modalities retain disclosed illustrative assumptions. Medication orders do not establish whether a person took a dose.']}
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'destination': str(DESTINATION), 'archiveSha256': result['source']['archiveSha256'], 'distributions': distributions}, indent=2))

if __name__ == '__main__':
    main()
