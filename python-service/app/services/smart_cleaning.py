"""Enterprise smart cleaning engine with audit trails and confidence scores.

This module implements a decision-based cleaning pipeline that:
- Never deletes rows unless they are exact duplicates or entirely empty
- Halts if >5% row loss would occur
- Generates per-cell audit logs (column, row, old, new, method, confidence, reason)
- Provides confidence scores for every correction
- Preserves maximum data while improving quality

Each cleaning action returns a CleaningResult containing the modified DataFrame
and a list of AuditEntry records documenting every change.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Audit trail data structures
# ---------------------------------------------------------------------------


@dataclass
class AuditEntry:
    """A single cell-level correction record."""
    timestamp: str
    column: str
    row_index: int
    old_value: Any
    new_value: Any
    method: str
    confidence: float
    reason: str

    def to_dict(self) -> dict:
        def _convert(v: Any) -> Any:
            if isinstance(v, (np.integer,)):
                return int(v)
            if isinstance(v, (np.floating,)):
                f = float(v)
                return f if not (np.isnan(f) or np.isinf(f)) else None
            if isinstance(v, (np.bool_,)):
                return bool(v)
            if isinstance(v, float):
                if np.isnan(v) or np.isinf(v):
                    return None
                return v
            if v is pd.NaT:
                return None
            return v
        return {
            "timestamp": self.timestamp,
            "column": self.column,
            "row_index": int(self.row_index),
            "old_value": _convert(self.old_value),
            "new_value": _convert(self.new_value),
            "method": self.method,
            "confidence": float(self.confidence),
            "reason": self.reason,
        }


@dataclass
class CleaningResult:
    """Result of a cleaning operation with audit trail."""
    df: pd.DataFrame
    audit_log: List[AuditEntry]
    summary: str
    rows_before: int
    rows_after: int
    cells_changed: int
    halted: bool = False
    halt_reason: str = ""

    def to_dict(self) -> dict:
        return {
            "summary": self.summary,
            "rows_before": self.rows_before,
            "rows_after": self.rows_after,
            "cells_changed": self.cells_changed,
            "halted": self.halted,
            "halt_reason": self.halt_reason,
            "audit_log": [e.to_dict() for e in self.audit_log],
        }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uniqueness_ratio(s: pd.Series) -> float:
    """Return the ratio of unique non-null values to total values."""
    n = len(s)
    if n == 0:
        return 0.0
    return s.nunique(dropna=True) / n


# ---------------------------------------------------------------------------
# Missing value sentinel detection
# ---------------------------------------------------------------------------

_MISSING_SENTINELS = {"", " ", "nan", "na", "n/a", "none", "null", "nil",
                      "missing", "unknown", "undefined", "?", "-", "___", "(blank)", "[blank]"}


def _is_sentinel(value: Any) -> bool:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return True
    s = str(value).strip().lower()
    return s in _MISSING_SENTINELS


def _normalize_sentinels(df: pd.DataFrame, columns: List[str]) -> Tuple[pd.DataFrame, List[AuditEntry]]:
    """Replace common missing-value sentinels with actual NaN."""
    out = df.copy()
    log: List[AuditEntry] = []
    for col in columns:
        if not pd.api.types.is_object_dtype(out[col]):
            continue
        mask = out[col].apply(_is_sentinel)
        count = int(mask.sum())
        if count == 0:
            continue
        for idx in out.index[mask]:
            old = out.at[idx, col]
            out.at[idx, col] = np.nan
            log.append(AuditEntry(
                timestamp=_now(), column=col, row_index=int(idx),
                old_value=old, new_value=None,
                method="sentinel_detection", confidence=1.0,
                reason=f"Value '{old}' matched known missing-value sentinel."
            ))
    return out, log


# ---------------------------------------------------------------------------
# Text cleaning
# ---------------------------------------------------------------------------


def _clean_text_value(value: Any) -> Tuple[Any, bool, str, float]:
    """Clean a single text value. Returns (new_value, changed, method, confidence)."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return value, False, "", 0.0

    s = str(value)
    original = s

    # Unicode normalization (NFKC).
    s = unicodedata.normalize("NFKC", s)

    # Remove invisible/control characters.
    s = "".join(ch for ch in s if unicodedata.category(ch)[0] != "C" or ch in "\n\t")

    # Replace tabs and multiple whitespace with single space.
    s = s.replace("\t", " ")
    s = re.sub(r"\s+", " ", s)

    # Strip leading/trailing whitespace.
    s = s.strip()

    if s == original:
        return value, False, "", 0.0
    return s, True, "text_normalization", 0.99


def clean_text(df: pd.DataFrame, columns: Optional[List[str]] = None) -> CleaningResult:
    """Trim whitespace, normalize unicode, remove invisible characters, collapse multiple spaces."""
    rows_before = len(df)
    out = df.copy()
    log: List[AuditEntry] = []
    cols = columns or [c for c in out.columns if pd.api.types.is_object_dtype(out[c])]

    for col in cols:
        if not pd.api.types.is_object_dtype(out[col]):
            continue
        for idx in out.index:
            new_val, changed, method, conf = _clean_text_value(out.at[idx, col])
            if changed:
                old = out.at[idx, col]
                out.at[idx, col] = new_val
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=new_val,
                    method=method, confidence=conf,
                    reason="Whitespace trimmed, unicode normalized, invisible chars removed."
                ))

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Cleaned text in {len(cols)} column(s); {len(log)} cell(s) modified.",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=len(log),
    )


# ---------------------------------------------------------------------------
# Name standardization
# ---------------------------------------------------------------------------


def _standardize_name(value: Any) -> Tuple[Any, bool, str, float]:
    """Standardize a name value to proper Title Case."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return value, False, "", 0.0

    s = str(value).strip()
    if not s:
        return value, False, "", 0.0

    # Check for garbage: all digits, single char, or excessive special chars.
    if re.match(r"^[0-9]+$", s):
        return value, False, "garbage_name_detected", 0.0
    if len(s) == 1:
        return value, False, "single_char_name", 0.0

    original = s
    # Title case with proper handling of apostrophes and hyphens.
    s = s.lower()
    # Capitalize first letter of each word, including after hyphens and apostrophes.
    s = re.sub(r"(?:^|[\s\-''])([a-z])", lambda m: m.group(0).upper(), s)

    if s == original:
        return value, False, "", 0.0
    return s, True, "name_standardization", 0.95


def standardize_names(df: pd.DataFrame, columns: Optional[List[str]] = None) -> CleaningResult:
    """Standardize name columns to proper Title Case."""
    rows_before = len(df)
    out = df.copy()
    log: List[AuditEntry] = []

    # Auto-detect name columns if not specified.
    if columns is None:
        columns = [c for c in out.columns if any(k in c.lower() for k in ("name", "first", "last", "full_name"))]

    for col in columns:
        if col not in out.columns:
            continue
        for idx in out.index:
            new_val, changed, method, conf = _standardize_name(out.at[idx, col])
            if changed:
                old = out.at[idx, col]
                out.at[idx, col] = new_val
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=new_val,
                    method=method, confidence=conf,
                    reason="Name converted to proper Title Case."
                ))

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Standardized names in {len(columns)} column(s); {len(log)} cell(s) modified.",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=len(log),
    )


# ---------------------------------------------------------------------------
# Category standardization
# ---------------------------------------------------------------------------

# Common category mappings.
_GENDER_MAP = {
    "m": "Male", "male": "Male", "man": "Male", "boy": "Male",
    "f": "Female", "female": "Female", "woman": "Female", "girl": "Female",
    "other": "Other", "non-binary": "Non-Binary", "nonbinary": "Non-Binary",
    "prefer not to say": "Prefer Not To Say", "na": None, "n/a": None,
}

_COUNTRY_MAP = {
    "usa": "United States", "us": "United States", "u.s.": "United States",
    "u.s.a.": "United States", "united states of america": "United States",
    "uk": "United Kingdom", "u.k.": "United Kingdom", "britain": "United Kingdom",
    "great britain": "United Kingdom", "england": "United Kingdom",
    "india": "India", "bharat": "India",
    "germany": "Germany", "deutschland": "Germany",
    "france": "France",
    "canada": "Canada",
    "australia": "Australia",
    "japan": "Japan",
    "china": "China",
    "brazil": "Brazil",
}


def _standardize_category(value: Any, mapping: Dict[str, Any]) -> Tuple[Any, bool, str, float]:
    """Standardize a categorical value using a mapping dict."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return value, False, "", 0.0
    s = str(value).strip()
    if not s:
        return value, False, "", 0.0
    key = s.lower()
    if key in mapping:
        new = mapping[key]
        if new is None:
            return value, False, "", 0.0
        if new != s:
            return new, True, "category_mapping", 0.98
    return value, False, "", 0.0


def standardize_categories(df: pd.DataFrame, columns: Optional[List[str]] = None) -> CleaningResult:
    """Standardize categorical columns (gender, country, etc.) using known mappings."""
    rows_before = len(df)
    out = df.copy()
    log: List[AuditEntry] = []

    for col in (columns or list(out.columns)):
        if col not in out.columns:
            continue
        lname = col.lower()
        mapping: Optional[Dict[str, Any]] = None
        if "gender" in lname or "sex" in lname:
            mapping = _GENDER_MAP
        elif "country" in lname or "nation" in lname:
            mapping = _COUNTRY_MAP
        if mapping is None:
            continue

        for idx in out.index:
            new_val, changed, method, conf = _standardize_category(out.at[idx, col], mapping)
            if changed:
                old = out.at[idx, col]
                out.at[idx, col] = new_val
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=new_val,
                    method=method, confidence=conf,
                    reason=f"Category '{old}' standardized to '{new_val}' using {lname} mapping."
                ))

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Standardized categories in {len(log)} cell(s).",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=len(log),
    )


# ---------------------------------------------------------------------------
# Email validation and repair
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_EMAIL_FIX_RE = re.compile(r"^([^@\s]+)@([^@\s]+)\.([^@\s]+)$")


def _repair_email(value: Any) -> Tuple[Any, bool, str, float, str]:
    """Attempt to repair an email. Returns (value, changed, method, confidence, reason)."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return value, False, "", 0.0, ""
    s = str(value).strip()
    if not s:
        return value, False, "", 0.0, ""

    if _EMAIL_RE.match(s):
        return value, False, "", 1.0, "Valid email."

    # Common fixes: trailing/leading spaces, double @, missing TLD.
    fixed = s.replace(" ", "")
    # Fix double @
    if fixed.count("@") > 1:
        parts = fixed.split("@")
        fixed = parts[0] + "@" + ".".join(parts[1:])
    # Add .com if missing TLD
    if "@" in fixed and "." not in fixed.split("@")[1]:
        fixed = fixed + ".com"

    if _EMAIL_RE.match(fixed) and fixed != s:
        return fixed, True, "email_repair", 0.85, f"Repaired email '{s}' -> '{fixed}'."

    return value, False, "invalid_email", 0.0, f"Could not repair email '{s}'."


def validate_and_repair_emails(df: pd.DataFrame, columns: Optional[List[str]] = None) -> CleaningResult:
    """Validate and attempt to repair email columns."""
    rows_before = len(df)
    out = df.copy()
    log: List[AuditEntry] = []

    if columns is None:
        columns = [c for c in out.columns if "email" in c.lower()]

    for col in columns:
        if col not in out.columns:
            continue
        for idx in out.index:
            val = out.at[idx, col]
            if val is None or (isinstance(val, float) and np.isnan(val)):
                continue
            new_val, changed, method, conf, reason = _repair_email(val)
            if changed:
                old = out.at[idx, col]
                out.at[idx, col] = new_val
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=new_val,
                    method=method, confidence=conf, reason=reason,
                ))
            elif method == "invalid_email":
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=val, new_value=val,
                    method="invalid_email_flag", confidence=0.0,
                    reason=f"Email '{val}' is invalid and could not be auto-repaired.",
                ))

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Email validation: {sum(1 for e in log if e.method == 'email_repair')} repaired, "
                f"{sum(1 for e in log if e.method == 'invalid_email_flag')} flagged invalid.",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=sum(1 for e in log if e.method == "email_repair"),
    )


# ---------------------------------------------------------------------------
# Date standardization
# ---------------------------------------------------------------------------


def _standardize_date(value: Any) -> Tuple[Any, bool, str, float, str]:
    """Standardize a date value to YYYY-MM-DD format."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return value, False, "", 0.0, ""
    if isinstance(value, (pd.Timestamp, datetime)):
        ts = pd.Timestamp(value)
        if ts != pd.NaT:
            return ts.strftime("%Y-%m-%d"), True, "date_standardization", 0.99, ""

    s = str(value).strip()
    if not s:
        return value, False, "", 0.0, ""

    try:
        parsed = pd.to_datetime(s, errors="raise")
        if parsed != pd.NaT:
            standardized = parsed.strftime("%Y-%m-%d")
            if standardized != s:
                return standardized, True, "date_standardization", 0.98, f"Parsed '{s}' -> '{standardized}'."
            return value, False, "", 1.0, "Already standardized."
    except Exception:
        pass

    return value, False, "invalid_date", 0.0, f"Could not parse '{s}' as date."


def standardize_dates(df: pd.DataFrame, columns: Optional[List[str]] = None) -> CleaningResult:
    """Standardize date columns to YYYY-MM-DD format."""
    rows_before = len(df)
    out = df.copy()
    log: List[AuditEntry] = []

    if columns is None:
        columns = [c for c in out.columns if any(k in c.lower() for k in ("date", "time", "dob", "birth", "signup", "created"))]

    for col in columns:
        if col not in out.columns:
            continue
        for idx in out.index:
            val = out.at[idx, col]
            new_val, changed, method, conf, reason = _standardize_date(val)
            if changed:
                old = out.at[idx, col]
                out.at[idx, col] = new_val
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=new_val,
                    method=method, confidence=conf, reason=reason,
                ))

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Date standardization: {len(log)} cell(s) converted to YYYY-MM-DD.",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=len(log),
    )


# ---------------------------------------------------------------------------
# Phone number standardization
# ---------------------------------------------------------------------------

_PHONE_RE = re.compile(r"^(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}$")


def _standardize_phone(value: Any) -> Tuple[Any, bool, str, float, str]:
    """Standardize a phone number to a consistent format: +CC-XXX-XXX-XXXX."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return value, False, "", 0.0, ""
    s = str(value).strip()
    if not s:
        return value, False, "", 0.0, ""

    # Extract all digits.
    digits = re.sub(r"[^\d+]", "", s)
    if not digits:
        return value, False, "invalid_phone", 0.0, f"Could not parse '{s}' as phone."

    # Handle country code.
    if digits.startswith("+"):
        has_cc = True
        digits = digits[1:]
    elif len(digits) > 10:
        has_cc = True
    else:
        has_cc = False

    if len(digits) < 7:
        return value, False, "invalid_phone", 0.0, f"Phone '{s}' has too few digits."

    # Format: group as CC-AREA-PREFIX-LINE.
    if has_cc and len(digits) > 10:
        cc = digits[:len(digits) - 10] if len(digits) > 10 else ""
        rest = digits[len(digits) - 10:] if len(digits) > 10 else digits
        if len(rest) == 10:
            formatted = f"+{cc}-{rest[:3]}-{rest[3:6]}-{rest[6:]}"
        else:
            formatted = f"+{digits}"
    elif len(digits) == 10:
        formatted = f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    elif len(digits) == 7:
        formatted = f"{digits[:3]}-{digits[3:]}"
    else:
        formatted = digits

    if formatted != s:
        return formatted, True, "phone_standardization", 0.92, f"Formatted '{s}' -> '{formatted}'."
    return value, False, "", 1.0, "Already standardized."


def standardize_phones(df: pd.DataFrame, columns: Optional[List[str]] = None) -> CleaningResult:
    """Standardize phone number columns to a consistent format."""
    rows_before = len(df)
    out = df.copy()
    log: List[AuditEntry] = []

    if columns is None:
        columns = [c for c in out.columns if "phone" in c.lower() or "mobile" in c.lower() or "tel" in c.lower()]

    for col in columns:
        if col not in out.columns:
            continue
        for idx in out.index:
            val = out.at[idx, col]
            new_val, changed, method, conf, reason = _standardize_phone(val)
            if changed:
                old = out.at[idx, col]
                out.at[idx, col] = new_val
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=new_val,
                    method=method, confidence=conf, reason=reason,
                ))
            elif method == "invalid_phone":
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=val, new_value=val,
                    method="invalid_phone_flag", confidence=0.0,
                    reason=f"Phone '{val}' is invalid.",
                ))

    repaired = sum(1 for e in log if e.method == "phone_standardization")
    flagged = sum(1 for e in log if e.method == "invalid_phone_flag")
    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Phone standardization: {repaired} formatted, {flagged} flagged invalid.",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=repaired,
    )


# ---------------------------------------------------------------------------
# Address standardization
# ---------------------------------------------------------------------------

_US_STATE_ABBR = {
    "al": "AL", "ak": "AK", "az": "AZ", "ar": "AR", "ca": "CA", "co": "CO",
    "ct": "CT", "de": "DE", "fl": "FL", "ga": "GA", "hi": "HI", "id": "ID",
    "il": "IL", "in": "IN", "ia": "IA", "ks": "KS", "ky": "KY", "la": "LA",
    "me": "ME", "md": "MD", "ma": "MA", "mi": "MI", "mn": "MN", "ms": "MS",
    "mo": "MO", "mt": "MT", "ne": "NE", "nv": "NV", "nh": "NH", "nj": "NJ",
    "nm": "NM", "ny": "NY", "nc": "NC", "nd": "ND", "oh": "OH", "ok": "OK",
    "or": "OR", "pa": "PA", "ri": "RI", "sc": "SC", "sd": "SD", "tn": "TN",
    "tx": "TX", "ut": "UT", "vt": "VT", "va": "VA", "wa": "WA", "wv": "WV",
    "wi": "WI", "wy": "WY", "dc": "DC",
}

_STREET_ABBR = {
    "st": "Street", "str": "Street", "ave": "Avenue", "av": "Avenue",
    "blvd": "Boulevard", "blv": "Boulevard", "rd": "Road", "dr": "Drive",
    "ln": "Lane", "ct": "Court", "pl": "Place", "cir": "Circle",
    "way": "Way", "pkwy": "Parkway", "hwy": "Highway", "sq": "Square",
    "apt": "Apt", "ste": "Ste", "fl": "Floor", "rm": "Room",
}


def _standardize_address(value: Any) -> Tuple[Any, bool, str, float, str]:
    """Standardize an address: normalize whitespace, expand abbreviations, title case."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return value, False, "", 0.0, ""
    s = str(value).strip()
    if not s:
        return value, False, "", 0.0, ""

    original = s
    # Normalize whitespace.
    s = re.sub(r"\s+", " ", s)

    # Expand common street abbreviations (word boundary, case-insensitive).
    parts = s.split()
    changed = False
    for i, word in enumerate(parts):
        bare = re.sub(r"[^a-zA-Z]", "", word).lower()
        if bare in _STREET_ABBR:
            # Preserve trailing punctuation like commas.
            suffix = ""
            clean = word.rstrip(",.;")
            if clean.lower() != bare:
                continue
            if word != clean:
                suffix = word[len(clean):]
            parts[i] = _STREET_ABBR[bare] + suffix
            changed = True
        elif bare in _US_STATE_ABBR and len(bare) == 2:
            parts[i] = _US_STATE_ABBR[bare]
            changed = True

    s = " ".join(parts)

    # Title case but keep all-caps state abbreviations.
    s = re.sub(r"(?:^|[\s#])([a-z])", lambda m: m.group(0).upper(), s)
    # Fix state abbreviations that got title-cased (e.g., "Ca" -> "CA").
    words = s.split()
    for i, word in enumerate(words):
        bare = re.sub(r"[^a-zA-Z]", "", word)
        if len(bare) == 2 and bare.upper() in _US_STATE_ABBR:
            words[i] = word.replace(bare, bare.upper())
    s = " ".join(words)

    if s != original:
        return s, True, "address_standardization", 0.90, f"Standardized address '{original}' -> '{s}'."
    return value, False, "", 1.0, "Already standardized."


def standardize_addresses(df: pd.DataFrame, columns: Optional[List[str]] = None) -> CleaningResult:
    """Standardize address columns."""
    rows_before = len(df)
    out = df.copy()
    log: List[AuditEntry] = []

    if columns is None:
        columns = [c for c in out.columns if any(k in c.lower() for k in ("address", "street", "addr", "location"))]

    for col in columns:
        if col not in out.columns:
            continue
        for idx in out.index:
            val = out.at[idx, col]
            new_val, changed, method, conf, reason = _standardize_address(val)
            if changed:
                old = out.at[idx, col]
                out.at[idx, col] = new_val
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=new_val,
                    method=method, confidence=conf, reason=reason,
                ))

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Address standardization: {len(log)} cell(s) standardized.",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=len(log),
    )


# ---------------------------------------------------------------------------
# URL standardization
# ---------------------------------------------------------------------------


def _standardize_url(value: Any) -> Tuple[Any, bool, str, float, str]:
    """Ensure URLs have a protocol prefix."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return value, False, "", 0.0, ""
    s = str(value).strip()
    if not s:
        return value, False, "", 0.0, ""
    if not s.startswith(("http://", "https://", "ftp://")):
        if s.startswith("www."):
            return f"https://{s}", True, "url_standardization", 0.95, f"Added https:// prefix to '{s}'."
        elif "." in s and " " not in s:
            return f"https://{s}", True, "url_standardization", 0.90, f"Added https:// prefix to '{s}'."
    return value, False, "", 1.0, "Already has protocol."


def standardize_urls(df: pd.DataFrame, columns: Optional[List[str]] = None) -> CleaningResult:
    """Standardize URL columns by ensuring protocol prefix."""
    rows_before = len(df)
    out = df.copy()
    log: List[AuditEntry] = []

    if columns is None:
        columns = [c for c in out.columns if any(k in c.lower() for k in ("url", "website", "link", "homepage"))]

    for col in columns:
        if col not in out.columns:
            continue
        for idx in out.index:
            val = out.at[idx, col]
            new_val, changed, method, conf, reason = _standardize_url(val)
            if changed:
                old = out.at[idx, col]
                out.at[idx, col] = new_val
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=new_val,
                    method=method, confidence=conf, reason=reason,
                ))

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"URL standardization: {len(log)} cell(s) standardized.",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=len(log),
    )


# ---------------------------------------------------------------------------
# Comprehensive validation engine
# ---------------------------------------------------------------------------

@dataclass
class ValidationReport:
    """Detailed validation report for a dataset."""
    total_issues: int
    issues: List[Dict[str, Any]]
    column_reports: Dict[str, Dict[str, Any]]
    overall_quality: float

    def to_dict(self) -> dict:
        return {
            "total_issues": self.total_issues,
            "issues": self.issues,
            "column_reports": self.column_reports,
            "overall_quality": round(self.overall_quality, 2),
        }


def validate_dataset(df: pd.DataFrame) -> ValidationReport:
    """Run comprehensive validation checks on a dataset.

    Checks:
    - Missing values (NaN and sentinel)
    - Duplicate rows
    - Email format
    - Phone format
    - Date parseability
    - URL format
    - Out-of-range numeric values (IQR outliers)
    - Mixed data types within a column
    - Inconsistent casing in categorical columns
    - Leading/trailing whitespace
    """
    issues: List[Dict[str, Any]] = []
    column_reports: Dict[str, Dict[str, Any]] = {}
    n = len(df)
    if n == 0:
        return ValidationReport(0, issues, column_reports, 100.0)

    for col in df.columns:
        s = df[col]
        col_issues: List[Dict[str, Any]] = []
        lname = col.lower()

        # Missing values.
        missing = int(s.isna().sum())
        sentinel_count = 0
        if pd.api.types.is_object_dtype(s):
            sentinel_count = int(s.apply(_is_sentinel).sum() - missing)
        total_missing = missing + sentinel_count
        missing_pct = round(total_missing / n * 100, 2) if n else 0
        if total_missing > 0:
            severity = "error" if missing_pct > 20 else "warning" if missing_pct > 5 else "info"
            col_issues.append({
                "rule": "missing_values",
                "column": col,
                "severity": severity,
                "message": f"{total_missing} missing value(s) ({missing_pct}%) in '{col}'.",
                "count": total_missing,
                "percentage": missing_pct,
            })

        # Leading/trailing whitespace.
        if pd.api.types.is_object_dtype(s):
            ws_count = int(s.dropna().astype(str).apply(lambda x: x != x.strip()).sum())
            if ws_count > 0:
                col_issues.append({
                    "rule": "whitespace",
                    "column": col,
                    "severity": "info",
                    "message": f"{ws_count} value(s) in '{col}' have leading/trailing spaces.",
                    "count": ws_count,
                })

        # Email validation.
        if "email" in lname:
            non_null = s.dropna().astype(str)
            invalid = int((~non_null.str.match(_EMAIL_RE)).sum())
            if invalid > 0:
                col_issues.append({
                    "rule": "email_format",
                    "column": col,
                    "severity": "error",
                    "message": f"{invalid} invalid email(s) in '{col}'.",
                    "count": invalid,
                })

        # Phone validation.
        if any(k in lname for k in ("phone", "mobile", "tel")):
            non_null = s.dropna().astype(str)
            invalid = int((~non_null.apply(lambda x: bool(_PHONE_RE.match(x)))).sum())
            if invalid > 0:
                col_issues.append({
                    "rule": "phone_format",
                    "column": col,
                    "severity": "warning",
                    "message": f"{invalid} invalid phone number(s) in '{col}'.",
                    "count": invalid,
                })

        # Date validation.
        if any(k in lname for k in ("date", "time", "dob", "birth", "signup", "created")):
            non_null = s.dropna()
            if pd.api.types.is_object_dtype(non_null):
                unparseable = 0
                for v in non_null:
                    try:
                        pd.to_datetime(str(v), errors="raise")
                    except Exception:
                        unparseable += 1
                if unparseable > 0:
                    col_issues.append({
                        "rule": "date_format",
                        "column": col,
                        "severity": "warning",
                        "message": f"{unparseable} unparseable date(s) in '{col}'.",
                        "count": unparseable,
                    })

        # URL validation.
        if any(k in lname for k in ("url", "website", "link", "homepage")):
            non_null = s.dropna().astype(str)
            no_protocol = int(non_null.apply(lambda x: not x.startswith(("http://", "https://", "ftp://"))).sum())
            if no_protocol > 0:
                col_issues.append({
                    "rule": "url_protocol",
                    "column": col,
                    "severity": "info",
                    "message": f"{no_protocol} URL(s) in '{col}' missing protocol prefix.",
                    "count": no_protocol,
                })

        # Outlier detection for numeric columns.
        if pd.api.types.is_numeric_dtype(s):
            q1, q3 = s.quantile(0.25), s.quantile(0.75)
            iqr = q3 - q1
            if iqr > 0 and not pd.isna(iqr):
                lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                outliers = int(((s < lo) | (s > hi)).sum())
                if outliers > 0:
                    col_issues.append({
                        "rule": "outliers_iqr",
                        "column": col,
                        "severity": "warning",
                        "message": f"{outliers} potential outlier(s) in '{col}' (IQR method).",
                        "count": outliers,
                    })

        # Mixed types in object columns.
        if pd.api.types.is_object_dtype(s):
            non_null = s.dropna()
            type_set = set()
            for v in non_null:
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    type_set.add("numeric")
                elif isinstance(v, str):
                    if v.replace(".", "", 1).replace("-", "", 1).isdigit():
                        type_set.add("numeric_string")
                    else:
                        type_set.add("text")
                elif isinstance(v, bool):
                    type_set.add("boolean")
                else:
                    type_set.add(type(v).__name__)
            if len(type_set) > 1:
                col_issues.append({
                    "rule": "mixed_types",
                    "column": col,
                    "severity": "info",
                    "message": f"Column '{col}' has mixed types: {', '.join(sorted(type_set))}.",
                })

        # Inconsistent casing in categorical columns.
        if pd.api.types.is_object_dtype(s) and _uniqueness_ratio(s) <= 0.05:
            non_null = s.dropna().astype(str)
            lower_set = set(non_null.str.lower().unique())
            original_set = set(non_null.unique())
            if len(lower_set) < len(original_set):
                col_issues.append({
                    "rule": "inconsistent_casing",
                    "column": col,
                    "severity": "info",
                    "message": f"Column '{col}' has inconsistent casing ({len(original_set)} unique vs {len(lower_set)} case-insensitive).",
                })

        column_reports[col] = {
            "issues": col_issues,
            "issue_count": len(col_issues),
            "missing": total_missing,
            "missing_pct": missing_pct,
        }
        issues.extend(col_issues)

    # Duplicate rows.
    dup_count = int(df.duplicated().sum())
    if dup_count > 0:
        issues.append({
            "rule": "duplicate_rows",
            "column": "*all*",
            "severity": "warning" if dup_count / n > 0.05 else "info",
            "message": f"{dup_count} duplicate row(s) ({round(dup_count / n * 100, 2)}%).",
            "count": dup_count,
        })

    # Overall quality score.
    total_cells = n * df.shape[1]
    missing_cells = int(df.isna().sum().sum())
    completeness = 1 - (missing_cells / total_cells) if total_cells else 1
    issue_penalty = min(len(issues) * 2, 30) / 100
    overall_quality = max(0, (completeness - issue_penalty) * 100)

    return ValidationReport(
        total_issues=len(issues),
        issues=issues,
        column_reports=column_reports,
        overall_quality=overall_quality,
    )


# ---------------------------------------------------------------------------
# Missing value imputation
# ---------------------------------------------------------------------------


def impute_missing(df: pd.DataFrame, columns: Optional[List[str]] = None,
                   numeric_strategy: str = "median",
                   categorical_strategy: str = "mode") -> CleaningResult:
    """Impute missing values with confidence-scored audit entries.

    Strategies:
    - Numeric: mean, median, mode
    - Categorical: mode
    - Date: forward fill then backward fill
    """
    rows_before = len(df)
    out = df.copy()
    log: List[AuditEntry] = []
    cols = columns or list(out.columns)

    for col in cols:
        if col not in out.columns:
            continue
        s = out[col]
        missing_mask = s.isna()
        count = int(missing_mask.sum())
        if count == 0:
            continue

        if pd.api.types.is_numeric_dtype(s):
            if numeric_strategy == "mean":
                fill_val = s.mean()
                method = "mean_imputation"
                conf = 0.85
                reason = f"Filled with mean ({round(fill_val, 4)})."
            elif numeric_strategy == "median":
                fill_val = s.median()
                method = "median_imputation"
                conf = 0.90
                reason = f"Filled with median ({round(fill_val, 4)})."
            elif numeric_strategy == "mode":
                mode = s.mode()
                fill_val = mode.iloc[0] if not mode.empty else 0
                method = "mode_imputation"
                conf = 0.75
                reason = f"Filled with mode ({fill_val})."
            else:
                continue
            for idx in out.index[missing_mask]:
                old = out.at[idx, col]
                out.at[idx, col] = fill_val
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=fill_val,
                    method=method, confidence=conf, reason=reason,
                ))
        elif pd.api.types.is_object_dtype(s) or pd.api.types.is_string_dtype(s):
            mode = s.mode(dropna=True)
            if mode.empty:
                continue
            fill_val = mode.iloc[0]
            for idx in out.index[missing_mask]:
                old = out.at[idx, col]
                out.at[idx, col] = fill_val
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=fill_val,
                    method="mode_imputation", confidence=0.80,
                    reason=f"Filled with mode ('{fill_val}').",
                ))
        elif pd.api.types.is_datetime64_any_dtype(s):
            out[col] = s.ffill().bfill()
            filled_mask = missing_mask & out[col].notna()
            for idx in out.index[filled_mask]:
                old = s[idx]
                new_val = out.at[idx, col]
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=old, new_value=new_val,
                    method="ffill_bfill", confidence=0.70,
                    reason="Filled using forward/backward fill.",
                ))

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Imputed {len(log)} missing value(s) using {numeric_strategy}/{categorical_strategy}.",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=len(log),
    )


# ---------------------------------------------------------------------------
# Outlier flagging (never deletion)
# ---------------------------------------------------------------------------


def flag_outliers(df: pd.DataFrame, columns: Optional[List[str]] = None,
                  method: str = "iqr") -> CleaningResult:
    """Flag outliers without deleting them. Returns the same DataFrame with audit entries."""
    rows_before = len(df)
    log: List[AuditEntry] = []

    cols = columns or [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]

    for col in cols:
        s = df[col]
        if s.empty or not pd.api.types.is_numeric_dtype(s):
            continue

        if method == "iqr":
            q1, q3 = s.quantile(0.25), s.quantile(0.75)
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            outlier_mask = (s < lo) | (s > hi)
            for idx in s.index[outlier_mask]:
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=s[idx], new_value=s[idx],
                    method="iqr_outlier_flag", confidence=0.90,
                    reason=f"Value {s[idx]} outside IQR bounds [{round(lo, 2)}, {round(hi, 2)}]. Row preserved."
                ))
        elif method == "zscore":
            std = s.std(ddof=0)
            if std == 0 or pd.isna(std):
                continue
            z = ((s - s.mean()) / std).abs()
            outlier_mask = z > 3
            for idx in s.index[outlier_mask]:
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=s[idx], new_value=s[idx],
                    method="zscore_outlier_flag", confidence=0.85,
                    reason=f"Value {s[idx]} has |z-score| > 3. Row preserved."
                ))
        elif method == "modified_zscore":
            median = s.median()
            mad = (s - median).abs().median()
            if mad == 0 or pd.isna(mad):
                continue
            modified_z = 0.6745 * (s - median) / mad
            outlier_mask = modified_z.abs() > 3.5
            for idx in s.index[outlier_mask]:
                log.append(AuditEntry(
                    timestamp=_now(), column=col, row_index=int(idx),
                    old_value=s[idx], new_value=s[idx],
                    method="modified_zscore_outlier_flag", confidence=0.88,
                    reason=f"Value {s[idx]} has modified |z-score| > 3.5 (median={median}, MAD={mad}). Row preserved."
                ))

    return CleaningResult(
        df=df, audit_log=log,
        summary=f"Flagged {len(log)} outlier(s) using {method}. No rows deleted.",
        rows_before=rows_before, rows_after=len(df),
        cells_changed=0,
    )


# ---------------------------------------------------------------------------
# Fuzzy duplicate detection
# ---------------------------------------------------------------------------

@dataclass
class FuzzyDuplicateGroup:
    """A group of rows that are likely duplicates of each other."""
    row_indices: List[int]
    similarity_score: float
    key_columns: List[str]
    suggested_action: str

    def to_dict(self) -> dict:
        return {
            "row_indices": self.row_indices,
            "similarity_score": round(self.similarity_score, 4),
            "key_columns": self.key_columns,
            "suggested_action": self.suggested_action,
        }


@dataclass
class FuzzyDuplicateResult:
    """Result of fuzzy duplicate detection."""
    groups: List[FuzzyDuplicateGroup]
    total_potential_duplicates: int
    summary: str

    def to_dict(self) -> dict:
        return {
            "groups": [g.to_dict() for g in self.groups],
            "total_potential_duplicates": self.total_potential_duplicates,
            "summary": self.summary,
        }


def _levenshtein_ratio(s1: str, s2: str) -> float:
    """Compute a similarity ratio between two strings (0-1) using a fast Levenshtein approximation."""
    if not s1 and not s2:
        return 1.0
    if not s1 or not s2:
        return 0.0
    # Quick check: if identical, return 1.
    if s1 == s2:
        return 1.0
    # Use difflib for a fast ratio.
    import difflib
    return difflib.SequenceMatcher(None, s1.lower(), s2.lower()).ratio()


def _row_similarity(row1: pd.Series, row2: pd.Series, text_cols: List[str],
                    numeric_cols: List[str], threshold: float = 0.85) -> float:
    """Compute overall similarity between two rows across text and numeric columns."""
    scores: List[float] = []
    for col in text_cols:
        v1 = str(row1[col]).strip().lower() if pd.notna(row1[col]) else ""
        v2 = str(row2[col]).strip().lower() if pd.notna(row2[col]) else ""
        if not v1 and not v2:
            continue
        scores.append(_levenshtein_ratio(v1, v2))
    for col in numeric_cols:
        v1 = row1[col]
        v2 = row2[col]
        if pd.isna(v1) and pd.isna(v2):
            continue
        if pd.isna(v1) or pd.isna(v2):
            scores.append(0.0)
            continue
        max_val = max(abs(v1), abs(v2), 1e-10)
        diff_ratio = 1 - abs(v1 - v2) / max_val
        scores.append(max(0, diff_ratio))
    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def detect_fuzzy_duplicates(df: pd.DataFrame, threshold: float = 0.85,
                            columns: Optional[List[str]] = None) -> FuzzyDuplicateResult:
    """Detect fuzzy (near) duplicate rows without deleting them.

    Uses string similarity for text columns and numeric proximity for numeric columns.
    Returns groups of likely duplicates with similarity scores for manual review.
    """
    n = len(df)
    if n < 2:
        return FuzzyDuplicateResult([], 0, "Not enough rows for fuzzy duplicate detection.")

    # Determine which columns to compare.
    if columns:
        text_cols = [c for c in columns if pd.api.types.is_object_dtype(df[c])]
        numeric_cols = [c for c in columns if pd.api.types.is_numeric_dtype(df[c])]
    else:
        # Use all columns except ID-like columns.
        exclude = set()
        for col in df.columns:
            lname = col.lower()
            if lname == "id" or lname.endswith("_id") or lname.startswith("id_") or "identifier" in lname:
                exclude.add(col)
        candidate_cols = [c for c in df.columns if c not in exclude]
        text_cols = [c for c in candidate_cols if pd.api.types.is_object_dtype(df[c])]
        numeric_cols = [c for c in candidate_cols if pd.api.types.is_numeric_dtype(df[c])]

    if not text_cols and not numeric_cols:
        return FuzzyDuplicateResult([], 0, "No comparable columns found.")

    # For performance, limit to datasets with <= 5000 rows for pairwise comparison.
    # For larger datasets, use blocking on first text column.
    groups: List[FuzzyDuplicateGroup] = []
    visited: set = set()

    if n <= 5000:
        for i in range(n):
            if i in visited:
                continue
            group_indices = [i]
            for j in range(i + 1, n):
                if j in visited:
                    continue
                sim = _row_similarity(df.iloc[i], df.iloc[j], text_cols, numeric_cols)
                if sim >= threshold:
                    group_indices.append(j)
                    visited.add(j)
            if len(group_indices) > 1:
                # Compute average similarity within the group.
                avg_sim = 0.0
                pair_count = 0
                for a in range(len(group_indices)):
                    for b in range(a + 1, len(group_indices)):
                        avg_sim += _row_similarity(
                            df.iloc[group_indices[a]], df.iloc[group_indices[b]],
                            text_cols, numeric_cols
                        )
                        pair_count += 1
                avg_sim = avg_sim / pair_count if pair_count else 0.0
                groups.append(FuzzyDuplicateGroup(
                    row_indices=[int(df.index[idx]) for idx in group_indices],
                    similarity_score=avg_sim,
                    key_columns=text_cols + numeric_cols,
                    suggested_action="review",
                ))
                visited.add(i)
    else:
        # Blocking strategy: group by first 2 chars of first text column.
        block_col = text_cols[0] if text_cols else numeric_cols[0]
        if block_col in text_cols:
            blocks = df[block_col].fillna("").astype(str).str[:2].str.lower()
        else:
            blocks = df[block_col].fillna(0).astype(int) // 100
        for block_key in blocks.unique():
            block_indices = df.index[blocks == block_key].tolist()
            if len(block_indices) < 2:
                continue
            for ii, i in enumerate(block_indices):
                if i in visited:
                    continue
                group_indices = [int(i)]
                for j in block_indices[ii + 1:]:
                    if j in visited:
                        continue
                    sim = _row_similarity(df.loc[i], df.loc[j], text_cols, numeric_cols)
                    if sim >= threshold:
                        group_indices.append(int(j))
                        visited.add(j)
                if len(group_indices) > 1:
                    groups.append(FuzzyDuplicateGroup(
                        row_indices=group_indices,
                        similarity_score=threshold,
                        key_columns=text_cols + numeric_cols,
                        suggested_action="review",
                    ))
                    visited.add(i)

    total_dups = sum(len(g.row_indices) - 1 for g in groups)
    summary = f"Found {len(groups)} fuzzy duplicate group(s) containing {total_dups} potential duplicate row(s). No rows deleted."

    return FuzzyDuplicateResult(
        groups=groups,
        total_potential_duplicates=total_dups,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Outlier summary report
# ---------------------------------------------------------------------------

@dataclass
class OutlierReport:
    """Summary report of outliers across all numeric columns."""
    column_reports: Dict[str, Dict[str, Any]]
    total_outliers: int
    summary: str

    def to_dict(self) -> dict:
        return {
            "column_reports": self.column_reports,
            "total_outliers": self.total_outliers,
            "summary": self.summary,
        }


def outlier_report(df: pd.DataFrame, columns: Optional[List[str]] = None) -> OutlierReport:
    """Generate a comprehensive outlier report using IQR, Z-score, and modified Z-score."""
    cols = columns or [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    column_reports: Dict[str, Dict[str, Any]] = {}
    total_unique = 0

    for col in cols:
        s = df[col].dropna()
        if s.empty:
            continue

        col_report: Dict[str, Any] = {}
        outlier_indices: set = set()

        # IQR method
        q1, q3 = s.quantile(0.25), s.quantile(0.75)
        iqr = q3 - q1
        if iqr > 0 and not pd.isna(iqr):
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            iqr_mask = (s < lo) | (s > hi)
            iqr_outliers = int(iqr_mask.sum())
            col_report["iqr"] = {
                "count": iqr_outliers,
                "bounds": [round(float(lo), 4), round(float(hi), 4)],
            }
            outlier_indices.update(s.index[iqr_mask].tolist())
        else:
            col_report["iqr"] = {"count": 0, "bounds": None}

        # Z-score method
        std = s.std(ddof=0)
        if std and std > 0 and not pd.isna(std):
            z = ((s - s.mean()) / std).abs()
            z_mask = z > 3
            z_outliers = int(z_mask.sum())
            col_report["zscore"] = {"count": z_outliers, "threshold": 3.0}
            outlier_indices.update(s.index[z_mask].tolist())
        else:
            col_report["zscore"] = {"count": 0, "threshold": 3.0}

        # Modified Z-score method
        median = s.median()
        mad = (s - median).abs().median()
        if mad and mad > 0 and not pd.isna(mad):
            modified_z = (0.6745 * (s - median) / mad).abs()
            mz_mask = modified_z > 3.5
            mz_outliers = int(mz_mask.sum())
            col_report["modified_zscore"] = {"count": mz_outliers, "threshold": 3.5}
            outlier_indices.update(s.index[mz_mask].tolist())
        else:
            col_report["modified_zscore"] = {"count": 0, "threshold": 3.5}

        unique_count = len(outlier_indices)
        col_report["total_unique_outliers"] = unique_count
        total_unique += unique_count
        column_reports[col] = col_report

    summary = f"Outlier analysis across {len(cols)} numeric column(s): {total_unique} unique outlier(s) flagged by any method. No rows deleted."

    return OutlierReport(
        column_reports=column_reports,
        total_outliers=total_unique,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Duplicate removal (exact only, with 5% threshold)
# ---------------------------------------------------------------------------

MAX_DELETION_PCT = 5.0


def remove_exact_duplicates(df: pd.DataFrame) -> CleaningResult:
    """Remove exact duplicate rows. Halts if >5% would be deleted."""
    rows_before = len(df)
    dup_mask = df.duplicated(keep="first")
    dup_count = int(dup_mask.sum())
    dup_pct = (dup_count / rows_before * 100) if rows_before else 0.0

    if dup_count == 0:
        return CleaningResult(
            df=df, audit_log=[],
            summary="No exact duplicates found.",
            rows_before=rows_before, rows_after=rows_before,
            cells_changed=0,
        )

    if dup_pct > MAX_DELETION_PCT:
        return CleaningResult(
            df=df, audit_log=[],
            summary=f"High data loss detected: {dup_count} duplicates ({round(dup_pct, 2)}%) would be removed. Manual approval required.",
            rows_before=rows_before, rows_after=rows_before,
            cells_changed=0,
            halted=True,
            halt_reason=f"Duplicate removal would delete {round(dup_pct, 2)}% of rows (max {MAX_DELETION_PCT}%). Manual approval required.",
        )

    out = df[~dup_mask].reset_index(drop=True)
    log = [
        AuditEntry(
            timestamp=_now(), column="*all*", row_index=int(idx),
            old_value="(duplicate row)", new_value="(removed)",
            method="exact_duplicate_removal", confidence=1.0,
            reason="Row was an exact duplicate of an earlier row."
        )
        for idx in df.index[dup_mask]
    ]

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Removed {dup_count} exact duplicate row(s) ({round(dup_pct, 2)}%).",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=dup_count,
    )


def remove_empty_rows(df: pd.DataFrame) -> CleaningResult:
    """Remove rows where ALL cells are empty/NaN."""
    rows_before = len(df)
    empty_mask = df.isna().all(axis=1) | df.apply(lambda r: r.astype(str).str.strip().eq("").all(), axis=1)
    empty_count = int(empty_mask.sum())

    if empty_count == 0:
        return CleaningResult(
            df=df, audit_log=[],
            summary="No fully empty rows found.",
            rows_before=rows_before, rows_after=rows_before,
            cells_changed=0,
        )

    out = df[~empty_mask].reset_index(drop=True)
    log = [
        AuditEntry(
            timestamp=_now(), column="*all*", row_index=int(idx),
            old_value="(empty row)", new_value="(removed)",
            method="empty_row_removal", confidence=1.0,
            reason="All cells in this row were empty/NaN."
        )
        for idx in df.index[empty_mask]
    ]

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Removed {empty_count} fully empty row(s).",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=empty_count,
    )


# ---------------------------------------------------------------------------
# Data type conversion
# ---------------------------------------------------------------------------


def _convert_value(value: Any, target: str) -> Tuple[Any, bool, str, float, str]:
    """Convert a single value to the target type."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return value, False, "", 0.0, ""

    s = str(value).strip()

    if target in ("int", "integer"):
        # Remove currency symbols, commas, percentages.
        cleaned = re.sub(r"[$€£¥,\s%]", "", s)
        try:
            v = int(float(cleaned))
            if str(v) != s:
                return v, True, "type_conversion", 0.95, f"Converted '{value}' to integer {v}."
        except ValueError:
            pass

    if target in ("float", "numeric"):
        cleaned = re.sub(r"[$€£¥,\s%]", "", s)
        try:
            v = float(cleaned)
            if str(v) != s:
                return v, True, "type_conversion", 0.95, f"Converted '{value}' to float {v}."
        except ValueError:
            pass

    if target == "percentage":
        cleaned = re.sub(r"[%\s]", "", s)
        try:
            v = float(cleaned) / 100.0
            return v, True, "type_conversion", 0.98, f"Converted '{value}' to decimal {v}."
        except ValueError:
            pass

    if target == "currency":
        cleaned = re.sub(r"[$€£¥,\s]", "", s)
        try:
            v = float(cleaned)
            return v, True, "type_conversion", 0.98, f"Converted currency '{value}' to numeric {v}."
        except ValueError:
            pass

    return value, False, "", 0.0, ""


def convert_data_types(df: pd.DataFrame, columns: Optional[List[str]] = None) -> CleaningResult:
    """Auto-convert columns to their best-guess data types with audit trail."""
    rows_before = len(df)
    out = df.copy()
    log: List[AuditEntry] = []
    cols = columns or list(out.columns)

    for col in cols:
        if col not in out.columns or not pd.api.types.is_object_dtype(out[col]):
            continue
        s = out[col]
        non_null = s.dropna().astype(str)

        # Check if column is numeric stored as string.
        numeric_ratio = pd.to_numeric(non_null, errors="coerce").notna().sum() / len(non_null) if len(non_null) else 0
        if numeric_ratio >= 0.9:
            for idx in out.index:
                val = out.at[idx, col]
                new_val, changed, method, conf, reason = _convert_value(val, "float")
                if changed:
                    out.at[idx, col] = new_val
                    log.append(AuditEntry(
                        timestamp=_now(), column=col, row_index=int(idx),
                        old_value=val, new_value=new_val,
                        method=method, confidence=conf, reason=reason,
                    ))
            # Convert column to numeric dtype.
            out[col] = pd.to_numeric(out[col], errors="coerce")

    return CleaningResult(
        df=out, audit_log=log,
        summary=f"Type conversion: {len(log)} cell(s) converted to proper data types.",
        rows_before=rows_before, rows_after=len(out),
        cells_changed=len(log),
    )


# ---------------------------------------------------------------------------
# Full auto-clean pipeline (v2)
# ---------------------------------------------------------------------------


def auto_clean_v2(df: pd.DataFrame) -> CleaningResult:
    """Run the full enterprise cleaning pipeline.

    Steps (in order):
    1. Normalize missing-value sentinels -> NaN
    2. Clean text (whitespace, unicode, invisible chars)
    3. Standardize names (Title Case)
    4. Standardize categories (gender, country)
    5. Validate and repair emails
    6. Standardize dates to YYYY-MM-DD
    7. Standardize phone numbers
    8. Standardize addresses
    9. Standardize URLs
    10. Convert data types (numeric strings -> numbers)
    11. Impute missing values (median for numeric, mode for categorical)
    12. Flag outliers (IQR method, no deletion)
    13. Remove exact duplicates (with 5% threshold)
    14. Remove fully empty rows

    Returns a single CleaningResult with the complete audit trail.
    """
    all_audit: List[AuditEntry] = []
    original_rows = len(df)
    current = df.copy()
    halted = False
    halt_reason = ""
    steps_summary: List[str] = []

    def merge(result: CleaningResult) -> None:
        nonlocal current, halted, halt_reason
        current = result.df
        all_audit.extend(result.audit_log)
        steps_summary.append(result.summary)
        if result.halted:
            halted = True
            halt_reason = result.halt_reason

    # 1. Sentinels
    out, log = _normalize_sentinels(current, list(current.columns))
    current = out
    all_audit.extend(log)
    steps_summary.append(f"Normalized {len(log)} missing-value sentinel(s).")

    # 2. Text cleaning
    merge(clean_text(current))

    # 3. Name standardization
    merge(standardize_names(current))

    # 4. Category standardization
    merge(standardize_categories(current))

    # 5. Email validation
    merge(validate_and_repair_emails(current))

    # 6. Date standardization
    merge(standardize_dates(current))

    # 7. Phone standardization
    merge(standardize_phones(current))

    # 8. Address standardization
    merge(standardize_addresses(current))

    # 9. URL standardization
    merge(standardize_urls(current))

    # 10. Type conversion
    merge(convert_data_types(current))

    # 11. Missing value imputation
    merge(impute_missing(current))

    # 12. Outlier flagging (no deletion)
    outlier_result = flag_outliers(current)
    all_audit.extend(outlier_result.audit_log)
    steps_summary.append(outlier_result.summary)

    # 13. Remove exact duplicates
    if not halted:
        merge(remove_exact_duplicates(current))

    # 14. Remove fully empty rows
    if not halted:
        merge(remove_empty_rows(current))

    total_cells_changed = sum(1 for e in all_audit if e.new_value != e.old_value and e.method != "outlier_flag" and e.method != "invalid_email_flag")

    summary = " | ".join(steps_summary)
    if halted:
        summary = f"HALTED: {halt_reason} | Completed steps: {summary}"

    return CleaningResult(
        df=current,
        audit_log=all_audit,
        summary=summary,
        rows_before=original_rows,
        rows_after=len(current),
        cells_changed=total_cells_changed,
        halted=halted,
        halt_reason=halt_reason,
    )
