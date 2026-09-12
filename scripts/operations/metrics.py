#!/usr/bin/env python3
"""Read numeric observations as JSON on stdin; emit only allowlisted metrics.
Exit: 0=all supplied values healthy, 1=warning, 2=critical, 3=no data/invalid.
No network, provider quotas, plan prices, scheduled alerts or secrets involved.
"""
import json
import math
import sys

# Local PoC policy, not contractual provider limits; >= is inclusive.
THRESHOLDS = {
    'backup_age_hours': (24, 48),
    'restore_drill_age_days': (30, 45),
    'api_5xx_percent': (1, 5),
    'api_p95_ms': (1000, 3000),
    'db_connections_percent': (70, 90),
    'quota_used_percent': (70, 90),
    'budget_used_percent': (70, 90),
    'outbox_oldest_seconds': (300, 900),
}


def assess(observed):
    if not isinstance(observed, dict):
        raise ValueError('invalid input')
    values, statuses = {}, {}
    for metric, (warn, critical) in THRESHOLDS.items():
        if metric not in observed:
            continue
        value = observed[metric]
        if type(value) not in (float, int) or not math.isfinite(value) or value < 0:
            raise ValueError('invalid observation')
        values[metric] = value
        statuses[metric] = 'critical' if value >= critical else 'warning' if value >= warn else 'ok'
    status = next((level for level in ('critical', 'warning', 'ok') if level in statuses.values()), 'unknown')
    return {'status': status, 'observed': values, 'checks': statuses,
            'missing': sorted(set(THRESHOLDS) - set(values)), 'scope': 'supplied_observations_only'}


def main():
    try:
        report = assess(json.load(sys.stdin))
        print(json.dumps(report, sort_keys=True))
        return {'ok': 0, 'warning': 1, 'critical': 2, 'unknown': 3}[report['status']]
    except Exception:
        print('{"status":"invalid_input"}')
        return 3


if __name__ == '__main__':
    sys.exit(main())
