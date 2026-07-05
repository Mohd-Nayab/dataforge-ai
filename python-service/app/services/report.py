"""Report Builder — aggregates profiling, validation, and analytics into a
single structured payload and renders a standalone HTML report."""
from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Any, Dict

import pandas as pd

from . import analytics, profiling


def build(df: pd.DataFrame, meta: Dict[str, Any]) -> Dict[str, Any]:
    """Aggregate everything we know about a dataset into one report payload."""
    profile = profiling.profile(df)
    issues = profiling.validate(df)
    overview = analytics.overview(df)

    severity_counts: Dict[str, int] = {}
    for issue in issues:
        sev = issue.get("severity", "info")
        severity_counts[sev] = severity_counts.get(sev, 0) + 1

    quality_score = _quality_score(profile, issues)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "id": meta.get("id"),
            "name": meta.get("name"),
            "filename": meta.get("filename"),
            "created_at": meta.get("created_at"),
            "updated_at": meta.get("updated_at"),
        },
        "summary": {
            "rows": profile["rows"],
            "columns": profile["columns"],
            "duplicate_rows": profile["duplicate_rows"],
            "missing_cells": profile["missing_cells"],
            "missing_pct": profile["missing_pct"],
            "memory_kb": profile["memory_kb"],
            "numeric_columns": overview["kpis"]["numeric_columns"],
            "categorical_columns": overview["kpis"]["categorical_columns"],
            "quality_score": quality_score,
        },
        "columns": profile["columns_detail"],
        "issues": issues,
        "issue_summary": severity_counts,
    }


def _quality_score(profile: Dict[str, Any], issues: list) -> int:
    """Heuristic 0-100 data-quality score: penalise missing data, duplicates,
    and validation errors/warnings."""
    score = 100.0
    score -= min(profile["missing_pct"], 40)  # up to -40 for missingness
    rows = profile["rows"] or 1
    dup_pct = profile["duplicate_rows"] / rows * 100
    score -= min(dup_pct, 20)  # up to -20 for duplicates
    for issue in issues:
        sev = issue.get("severity", "info")
        score -= {"error": 5, "warning": 2, "info": 0.5, "success": 0}.get(sev, 0.5)
    return max(0, min(100, round(score)))


def render_html(report: Dict[str, Any]) -> str:
    ds = report["dataset"]
    s = report["summary"]
    name = html.escape(str(ds.get("name") or "Dataset"))

    def kpi(label: str, value: Any) -> str:
        return (
            f'<div class="kpi"><div class="kpi-label">{html.escape(label)}</div>'
            f'<div class="kpi-value">{html.escape(str(value))}</div></div>'
        )

    kpis = "".join([
        kpi("Rows", f'{s["rows"]:,}'),
        kpi("Columns", s["columns"]),
        kpi("Quality score", f'{s["quality_score"]}/100'),
        kpi("Missing", f'{s["missing_pct"]}%'),
        kpi("Duplicates", s["duplicate_rows"]),
        kpi("Memory", f'{s["memory_kb"]} KB'),
        kpi("Numeric cols", s["numeric_columns"]),
        kpi("Categorical cols", s["categorical_columns"]),
    ])

    col_rows = ""
    for c in report["columns"]:
        col_rows += (
            "<tr>"
            f'<td>{html.escape(str(c["name"]))}</td>'
            f'<td>{html.escape(str(c["dtype"]))}</td>'
            f'<td>{c.get("missing", 0)} ({c.get("missing_pct", 0)}%)</td>'
            f'<td>{c.get("unique", "")}</td>'
            f'<td>{html.escape(str(c.get("mean", c.get("top", ""))))}</td>'
            "</tr>"
        )

    issue_rows = ""
    for i in report["issues"]:
        sev = html.escape(str(i.get("severity", "info")))
        issue_rows += (
            f'<tr class="sev-{sev}">'
            f'<td>{sev}</td>'
            f'<td>{html.escape(str(i.get("column", "—")))}</td>'
            f'<td>{html.escape(str(i.get("message", "")))}</td>'
            "</tr>"
        )
    if not issue_rows:
        issue_rows = '<tr><td colspan="3">No validation issues detected.</td></tr>'

    generated = html.escape(report["generated_at"])

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DataForge Report — {name}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         margin: 0; background: #0f172a; color: #e2e8f0; }}
  .wrap {{ max-width: 960px; margin: 0 auto; padding: 40px 24px; }}
  h1 {{ font-size: 28px; margin: 0 0 4px; }}
  .muted {{ color: #94a3b8; font-size: 13px; }}
  h2 {{ font-size: 18px; margin: 32px 0 12px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }}
  .kpis {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px; }}
  .kpi {{ background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 14px; }}
  .kpi-label {{ font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; }}
  .kpi-value {{ font-size: 22px; font-weight: 700; margin-top: 4px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }}
  th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid #1e293b; }}
  th {{ color: #94a3b8; text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }}
  .sev-error td {{ color: #fca5a5; }}
  .sev-warning td {{ color: #fcd34d; }}
  .badge {{ display: inline-block; background: linear-gradient(135deg,#6366f1,#d946ef);
            padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }}
  footer {{ margin-top: 40px; color: #64748b; font-size: 12px; text-align: center; }}
</style>
</head>
<body>
  <div class="wrap">
    <span class="badge">DataForge AI</span>
    <h1>Data Report — {name}</h1>
    <div class="muted">Generated {generated}</div>

    <h2>Summary</h2>
    <div class="kpis">{kpis}</div>

    <h2>Columns ({s["columns"]})</h2>
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Missing</th><th>Unique</th><th>Mean / Top</th></tr></thead>
      <tbody>{col_rows}</tbody>
    </table>

    <h2>Validation issues</h2>
    <table>
      <thead><tr><th>Severity</th><th>Column</th><th>Message</th></tr></thead>
      <tbody>{issue_rows}</tbody>
    </table>

    <footer>Generated by DataForge AI · Data quality score {s["quality_score"]}/100</footer>
  </div>
</body>
</html>"""
