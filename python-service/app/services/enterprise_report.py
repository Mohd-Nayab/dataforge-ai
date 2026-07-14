"""Enterprise report builder — comprehensive reports with audit trail, quality scores,
outlier analysis, fuzzy duplicates, and multi-sheet Excel export."""
from __future__ import annotations

import html
import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd

from . import enterprise_profiler, smart_cleaning


def build_enterprise_report(df: pd.DataFrame, meta: Dict[str, Any],
                            audit_log: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """Build a comprehensive enterprise report payload.

    Each analysis component is wrapped in try/except so a failure in one
    section doesn't prevent the rest of the report from being generated.
    """
    try:
        profile = enterprise_profiler.profile_dataset(df)
    except Exception as e:
        profile = {"error": f"Profiling failed: {e}"}

    try:
        validation = smart_cleaning.validate_dataset(df).to_dict()
    except Exception as e:
        validation = {"error": f"Validation failed: {e}", "total_issues": 0, "issues": []}

    try:
        outliers = smart_cleaning.outlier_report(df).to_dict()
    except Exception as e:
        outliers = {"error": f"Outlier analysis failed: {e}", "total_outliers": 0, "column_reports": {}}

    try:
        fuzzy = smart_cleaning.detect_fuzzy_duplicates(df).to_dict()
    except Exception as e:
        fuzzy = {"error": f"Fuzzy duplicate detection failed: {e}", "groups": [], "total_potential_duplicates": 0}

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "id": meta.get("id"),
            "name": meta.get("name"),
            "filename": meta.get("filename"),
            "created_at": meta.get("created_at"),
            "updated_at": meta.get("updated_at"),
        },
        "profile": profile,
        "validation": validation,
        "outliers": outliers,
        "fuzzy_duplicates": fuzzy,
        "audit_log": audit_log or [],
    }


def export_excel_multi_sheet(df: pd.DataFrame, meta: Dict[str, Any],
                             audit_log: Optional[List[Dict]] = None,
                             report: Optional[Dict[str, Any]] = None) -> bytes:
    """Generate a multi-sheet Excel workbook with Data, Profile, Validation,
    Outliers, Fuzzy Duplicates, and Audit Log sheets.

    If a pre-built report dict is provided, reuses its computations instead of
    recomputing profile/validation/outliers/fuzzy from scratch.
    """
    if report is None:
        report = build_enterprise_report(df, meta, audit_log)

    profile = report["profile"]
    val = report["validation"]
    outliers = report["outliers"]
    fuzzy = report["fuzzy_duplicates"]

    buf = io.BytesIO()

    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        # Sheet 1: Data
        df.to_excel(writer, index=False, sheet_name="Data")

        # Sheet 2: Profile — column details
        col_details = profile.get("columns_detail", [])
        if col_details:
            prof_df = pd.DataFrame(col_details)
            prof_df.to_excel(writer, index=False, sheet_name="Profile")
        # Quality scores sheet
        scores = profile.get("quality_scores", {})
        if scores:
            scores_df = pd.DataFrame([
                {"metric": k, "score": v} for k, v in scores.items()
            ])
            scores_df.to_excel(writer, index=False, sheet_name="Quality Scores")

        # Sheet 3: Validation
        if val.get("issues"):
            val_df = pd.DataFrame(val["issues"])
            val_df.to_excel(writer, index=False, sheet_name="Validation")

        # Sheet 4: Outliers
        outlier_rows: List[Dict[str, Any]] = []
        for col, rpt in outliers.get("column_reports", {}).items():
            outlier_rows.append({
                "column": col,
                "iqr_count": rpt.get("iqr", {}).get("count", 0),
                "iqr_bounds": str(rpt.get("iqr", {}).get("bounds", "")),
                "zscore_count": rpt.get("zscore", {}).get("count", 0),
                "modified_zscore_count": rpt.get("modified_zscore", {}).get("count", 0),
                "total_unique": rpt.get("total_unique_outliers", 0),
            })
        if outlier_rows:
            out_df = pd.DataFrame(outlier_rows)
            out_df.to_excel(writer, index=False, sheet_name="Outliers")

        # Sheet 5: Fuzzy Duplicates
        fuzzy_rows: List[Dict[str, Any]] = []
        for i, group in enumerate(fuzzy.get("groups", [])):
            for row_idx in group.get("row_indices", []):
                fuzzy_rows.append({
                    "group": i + 1,
                    "row_index": row_idx,
                    "similarity_score": group.get("similarity_score", 0),
                    "suggested_action": group.get("suggested_action", ""),
                })
        if fuzzy_rows:
            fuzz_df = pd.DataFrame(fuzzy_rows)
            fuzz_df.to_excel(writer, index=False, sheet_name="Fuzzy Duplicates")

        # Sheet 6: Audit Log
        if audit_log:
            audit_df = pd.DataFrame(audit_log)
            audit_df.to_excel(writer, index=False, sheet_name="Audit Log")

        # Sheet 7: Summary
        summary_data = {
            "Metric": [
                "Dataset Name", "Rows", "Columns", "Total Cells",
                "Missing Cells", "Missing %", "Duplicate Rows", "Duplicate %",
                "Memory (MB)", "Overall Quality Score",
                "Completeness", "Consistency", "Validity",
                "Accuracy", "Uniqueness", "Integrity",
                "Total Validation Issues", "Total Outliers",
                "Fuzzy Duplicate Groups", "Potential Duplicates",
                "Audit Log Entries",
            ],
            "Value": [
                meta.get("name", ""),
                profile.get("rows", 0),
                profile.get("columns", 0),
                profile.get("total_cells", 0),
                profile.get("missing_cells", 0),
                f"{profile.get('missing_pct', 0)}%",
                profile.get("duplicate_rows", 0),
                f"{profile.get('duplicate_pct', 0)}%",
                profile.get("memory_mb", 0),
                profile.get("quality_scores", {}).get("overall", 0),
                profile.get("quality_scores", {}).get("completeness", 0),
                profile.get("quality_scores", {}).get("consistency", 0),
                profile.get("quality_scores", {}).get("validity", 0),
                profile.get("quality_scores", {}).get("accuracy", 0),
                profile.get("quality_scores", {}).get("uniqueness", 0),
                profile.get("quality_scores", {}).get("integrity", 0),
                val.get("total_issues", 0),
                outliers.get("total_outliers", 0),
                len(fuzzy.get("groups", [])),
                fuzzy.get("total_potential_duplicates", 0),
                len(audit_log or []),
            ],
        }
        summary_df = pd.DataFrame(summary_data)
        summary_df.to_excel(writer, index=False, sheet_name="Summary")

    return buf.getvalue()


def render_enterprise_html(report: Dict[str, Any]) -> str:
    """Render a comprehensive standalone HTML report."""
    ds = report["dataset"]
    profile = report["profile"]
    val = report["validation"]
    outliers = report["outliers"]
    fuzzy = report["fuzzy_duplicates"]
    audit = report.get("audit_log", [])
    scores = profile.get("quality_scores", {})

    name = html.escape(str(ds.get("name") or "Dataset"))
    generated = html.escape(report.get("generated_at", ""))

    def kpi(label: str, value: Any) -> str:
        return (
            f'<div class="kpi"><div class="kpi-label">{html.escape(label)}</div>'
            f'<div class="kpi-value">{html.escape(str(value))}</div></div>'
        )

    kpis = "".join([
        kpi("Rows", f'{profile.get("rows", 0):,}'),
        kpi("Columns", profile.get("columns", 0)),
        kpi("Quality", f'{scores.get("overall", 0)}/100'),
        kpi("Missing", f'{profile.get("missing_pct", 0)}%'),
        kpi("Duplicates", profile.get("duplicate_rows", 0)),
        kpi("Memory", f'{profile.get("memory_mb", 0)} MB'),
    ])

    score_cards = "".join([
        kpi("Completeness", scores.get("completeness", 0)),
        kpi("Consistency", scores.get("consistency", 0)),
        kpi("Validity", scores.get("validity", 0)),
        kpi("Accuracy", scores.get("accuracy", 0)),
        kpi("Uniqueness", scores.get("uniqueness", 0)),
        kpi("Integrity", scores.get("integrity", 0)),
    ])

    # Column details table
    col_rows = ""
    for c in profile.get("columns_detail", []):
        col_rows += (
            "<tr>"
            f'<td>{html.escape(str(c.get("name", "")))}</td>'
            f'<td>{html.escape(str(c.get("semantic_type", "")))}</td>'
            f'<td>{html.escape(str(c.get("dtype", "")))}</td>'
            f'<td>{c.get("missing", 0)} ({c.get("missing_pct", 0)}%)</td>'
            f'<td>{c.get("unique", "")}</td>'
            f'<td>{html.escape(str(c.get("mean", c.get("top", ""))))}</td>'
            f'<td>{c.get("outliers", 0)}</td>'
            "</tr>"
        )

    # Validation issues
    issue_rows = ""
    for i in val.get("issues", []):
        sev = html.escape(str(i.get("severity", "info")))
        issue_rows += (
            f'<tr class="sev-{sev}">'
            f'<td>{sev}</td>'
            f'<td>{html.escape(str(i.get("column", "—")))}</td>'
            f'<td>{html.escape(str(i.get("rule", "")))}</td>'
            f'<td>{html.escape(str(i.get("message", "")))}</td>'
            "</tr>"
        )
    if not issue_rows:
        issue_rows = '<tr><td colspan="4">No validation issues detected.</td></tr>'

    # Outlier summary
    outlier_rows = ""
    for col, rpt in outliers.get("column_reports", {}).items():
        outlier_rows += (
            "<tr>"
            f'<td>{html.escape(col)}</td>'
            f'<td>{rpt.get("iqr", {}).get("count", 0)}</td>'
            f'<td>{rpt.get("zscore", {}).get("count", 0)}</td>'
            f'<td>{rpt.get("modified_zscore", {}).get("count", 0)}</td>'
            f'<td>{rpt.get("total_unique_outliers", 0)}</td>'
            "</tr>"
        )
    if not outlier_rows:
        outlier_rows = '<tr><td colspan="5">No outliers detected.</td></tr>'

    # Fuzzy duplicates
    fuzzy_rows = ""
    for i, group in enumerate(fuzzy.get("groups", [])):
        fuzzy_rows += (
            f'<tr><td>{i + 1}</td>'
            f'<td>{", ".join(str(r) for r in group.get("row_indices", []))}</td>'
            f'<td>{group.get("similarity_score", 0):.2%}</td>'
            f'<td>{html.escape(str(group.get("suggested_action", "")))}</td></tr>'
        )
    if not fuzzy_rows:
        fuzzy_rows = '<tr><td colspan="4">No fuzzy duplicates detected.</td></tr>'

    # Audit log summary
    audit_summary = ""
    if audit:
        audit_methods: Dict[str, int] = {}
        for entry in audit:
            method = entry.get("method", "unknown")
            audit_methods[method] = audit_methods.get(method, 0) + 1
        audit_summary = "".join([
            f'<div class="audit-method">{html.escape(m)}: <strong>{c}</strong></div>'
            for m, c in sorted(audit_methods.items())
        ])
    else:
        audit_summary = '<div class="muted">No audit entries. Run Smart Clean to generate an audit trail.</div>'

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Enterprise Report — {name}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         margin: 0; background: #0f172a; color: #e2e8f0; }}
  .wrap {{ max-width: 1100px; margin: 0 auto; padding: 40px 24px; }}
  h1 {{ font-size: 28px; margin: 0 0 4px; }}
  h2 {{ font-size: 18px; margin: 32px 0 12px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }}
  .muted {{ color: #94a3b8; font-size: 13px; }}
  .kpis {{ display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-top: 16px; }}
  .kpi {{ background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 14px; }}
  .kpi-label {{ font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; }}
  .kpi-value {{ font-size: 22px; font-weight: 700; margin-top: 4px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }}
  th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid #1e293b; }}
  th {{ color: #94a3b8; text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }}
  .sev-error td {{ color: #fca5a5; }}
  .sev-warning td {{ color: #fcd34d; }}
  .sev-info td {{ color: #93c5fd; }}
  .badge {{ display: inline-block; background: linear-gradient(135deg,#6366f1,#d946ef);
            padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }}
  .audit-method {{ display: inline-block; margin-right: 16px; font-size: 13px; color: #94a3b8; }}
  .grid-2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }}
  footer {{ margin-top: 40px; color: #64748b; font-size: 12px; text-align: center; }}
</style>
</head>
<body>
  <div class="wrap">
    <span class="badge">DataForge AI — Enterprise Report</span>
    <h1>Data Report — {name}</h1>
    <div class="muted">Generated {generated}</div>

    <h2>Summary</h2>
    <div class="kpis">{kpis}</div>

    <h2>Quality Scores</h2>
    <div class="kpis">{score_cards}</div>

    <h2>Columns ({profile.get("columns", 0)})</h2>
    <table>
      <thead><tr><th>Name</th><th>Semantic Type</th><th>Dtype</th><th>Missing</th><th>Unique</th><th>Mean / Top</th><th>Outliers</th></tr></thead>
      <tbody>{col_rows}</tbody>
    </table>

    <div class="grid-2">
      <div>
        <h2>Validation Issues ({val.get("total_issues", 0)})</h2>
        <table>
          <thead><tr><th>Severity</th><th>Column</th><th>Rule</th><th>Message</th></tr></thead>
          <tbody>{issue_rows}</tbody>
        </table>
      </div>
      <div>
        <h2>Outlier Analysis</h2>
        <table>
          <thead><tr><th>Column</th><th>IQR</th><th>Z-Score</th><th>Mod Z</th><th>Total</th></tr></thead>
          <tbody>{outlier_rows}</tbody>
        </table>
      </div>
    </div>

    <h2>Fuzzy Duplicate Detection</h2>
    <table>
      <thead><tr><th>Group</th><th>Row Indices</th><th>Similarity</th><th>Action</th></tr></thead>
      <tbody>{fuzzy_rows}</tbody>
    </table>

    <h2>Audit Trail ({len(audit)} entries)</h2>
    {audit_summary}

    <footer>Generated by DataForge AI Enterprise · Quality score {scores.get("overall", 0)}/100</footer>
  </div>
</body>
</html>"""
