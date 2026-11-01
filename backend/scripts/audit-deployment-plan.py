"""Offline only: read every archived CSV and local migration; no DB/env/network.
Run from repository root: python backend/scripts/audit-deployment-plan.py
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'docs/supabase-schema-audit/Supabase Snippet Untitled query (5).zip'
OUT = ROOT / 'docs/deployment-6.1'


def digest(value):
    return hashlib.sha256(value).hexdigest()


def body(definition):
    match = re.search(r'AS \$([^$]*)\$(.*?)\$\1\$', definition, re.S)
    return match.group(2) if match else ''


def checksum(value):
    return hashlib.md5(re.sub(r'\s+', ' ', value.replace('\r', '')).encode()).hexdigest()


def main():
    exports = []
    all_rows = []
    with zipfile.ZipFile(ARCHIVE) as archive:
        for name in sorted(archive.namelist()):
            if not name.endswith('.csv'):
                continue
            raw = archive.read(name)
            rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
            exports.append({'file': name, 'rows': len(rows), 'sha256': digest(raw),
                            'columns': list(rows[0]) if rows else []})
            all_rows.extend(rows)
    assert len(exports) == 14, 'Expected all 14 CSVs; stop if archive changed'
    functions = {r['proname']: r for r in all_rows if 'proname' in r and 'definition' in r}
    expected = {'tv3_scheduling_input': 'cd4e4b5440ae3f1a38567d7dd0acf8b9',
                'persist_schedule_draft': 'f3dfa0c40d77478ab317079fc68405e6',
                'generate_schedule_draft': '477fbe0785dcdbd85cd7cdf1dc600509'}
    guards = []
    for name, md5 in expected.items():
        row = functions.get(name, {})
        actual = checksum(body(row.get('definition', '')))
        grants = sorted({r['grantee'] for r in all_rows if r.get('proname') == name and 'grantee' in r})
        allowed = {'postgres'} if name == 'tv3_scheduling_input' else {'postgres', 'service_role'}
        guards.append({'function': name, 'body_md5': actual, 'expected_md5': md5,
                       'owner': row.get('owner'), 'grantees': grants,
                       'matches_archived_guard': actual == md5 and row.get('owner') == 'postgres'
                       and row.get('security_definer') == 'true' and set(grants) <= allowed})
    migrations = []
    local_bodies = {}
    for path in sorted((ROOT / 'backend/migrations').glob('*.sql')):
        raw = path.read_bytes()
        text = raw.decode('utf-8-sig')
        for name, source in re.findall(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\(.*?AS\s+\$\$(.*?)\$\$;', text, re.S | re.I):
            local_bodies.setdefault(name, []).append((path.name, checksum(source)))
        migrations.append({'file': path.name, 'sha256': digest(raw), 'lines': len(text.splitlines()),
                           'functions_declared': re.findall(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)', text, re.I),
                           'transaction_wrapped': bool(re.search(r'^BEGIN;', text, re.M)) and bool(re.search(r'COMMIT;\s*$', text))})
    triggers = [r for r in all_rows if 'tgname' in r]
    columns = [r for r in all_rows if 'ordinal_position' in r]
    result = {'scope': 'ARCHIVED_EVIDENCE_ONLY_NOT_LIVE_DATABASE', 'remote_access': False,
              'archive_sha256': digest(ARCHIVE.read_bytes()), 'exports': exports,
              'migrations': migrations, 'tv3_guards': guards,
              'archived_function_names': sorted(functions),
              'archived_function_local_matches': {name: [file for file, md5 in local_bodies.get(name, [])
                                                         if md5 == checksum(body(row['definition']))]
                                                  for name, row in functions.items()},
              'archived_trigger_names': sorted(r['tgname'] for r in triggers),
              'column_export_incomplete': len(columns) == 100,
              'dev_import': 'BLOCKER: sample excluded by ordinary TS and SQL readers; no persisted allowlist contract',
              'seed_apply_allowed': False, 'migration_apply_allowed': False}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'offline-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'csv_files': len(exports), 'migration_files': len(migrations),
                      'archived_tv3_guards_match': all(g['matches_archived_guard'] for g in guards),
                      'column_export_incomplete': result['column_export_incomplete'],
                      'output': 'docs/deployment-6.1/offline-audit.json', 'apply_allowed': False}))


if __name__ == '__main__':
    main()
