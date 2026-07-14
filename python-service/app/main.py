"""DataForge AI — FastAPI data engine."""
from __future__ import annotations

import io
import logging
import math
from typing import Optional

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .cache import query_cache
from .config import CORS_ORIGINS, PREVIEW_PAGE_SIZE
from .dask_loader import load_dask_dataframe
from .loader import UnsupportedFileError, load_dataframe
from .polars_loader import load_polars_dataframe, polars_to_pandas
from .schemas import (
    AnalyticsRequest,
    ChatRequest,
    ClusterRequest,
    ForecastRequest,
    JoinRequest,
    MLPredictRequest,
    MLTrainRequest,
    OperationRequest,
    SmartCleanRequest,
    SqlRequest,
)
from .security import FileValidationError, RateLimitMiddleware, SecurityHeadersMiddleware, validate_file
from .services import (
    ai_chat,
    analytics,
    cleaning,
    enterprise_profiler,
    enterprise_report,
    forecast,
    insights,
    join,
    ml,
    profiling,
    report,
    smart_cleaning,
    sql,
)
from .services.sql import SqlError
from .store import store
from .utils import column_dtype, df_to_records

app = FastAPI(title="DataForge AI — Data Engine", version="1.0.0")

# In-memory audit log storage per dataset (last smart-clean result).
_audit_logs: dict[str, list[dict]] = {}
_MAX_AUDIT_DATASETS = 50


def _store_audit_log(dataset_id: str, log: list[dict]) -> None:
    """Store audit log with bounded size — evicts oldest entries when limit exceeded."""
    if len(_audit_logs) >= _MAX_AUDIT_DATASETS and dataset_id not in _audit_logs:
        # Evict the oldest entry (first inserted key)
        oldest = next(iter(_audit_logs))
        del _audit_logs[oldest]
    _audit_logs[dataset_id] = log

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RateLimitMiddleware, window_seconds=60, max_requests=300)
app.add_middleware(SecurityHeadersMiddleware)

logger = logging.getLogger("dataforge")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


def _require_df(dataset_id: str) -> pd.DataFrame:
    try:
        return store.get_df(dataset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Dataset not found")


@app.get("/health")
def health():
    return {"status": "ok", "service": "dataforge-python"}


# ---------------------------------------------------------------- upload
@app.post("/datasets/upload")
async def upload(
    file: UploadFile = File(...),
    owner: Optional[str] = Form(None),
    engine: Optional[str] = Form("pandas"),
):
    content = await file.read()

    # Validate file before parsing
    try:
        validate_file(file.filename or "upload", content, file.content_type or "")
    except FileValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        if engine == "polars":
            df = polars_to_pandas(load_polars_dataframe(file.filename or "upload", content))
        elif engine == "dask":
            df = load_dask_dataframe(file.filename or "upload", content).compute()
        else:
            df = load_dataframe(file.filename or "upload", content)
    except UnsupportedFileError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {e}")

    name = (file.filename or "dataset").rsplit(".", 1)[0]
    meta = store.create(name=name, filename=file.filename or "upload",
                        df=df, owner=owner)
    return {**meta.to_dict(), "engine": engine or "pandas"}


# ---------------------------------------------------------------- datasets
@app.get("/datasets")
def list_datasets(owner: Optional[str] = Query(None)):
    return [m.to_dict() for m in store.list(owner=owner)]


@app.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str):
    try:
        meta = store.get_meta(dataset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return meta.to_dict()


@app.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: str):
    try:
        store.delete(dataset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {"deleted": dataset_id}


@app.post("/datasets/{dataset_id}/undo")
def undo(dataset_id: str):
    try:
        meta = store.undo(dataset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return meta.to_dict()


# ---------------------------------------------------------------- preview
@app.get("/datasets/{dataset_id}/preview")
def preview(dataset_id: str,
            page: int = Query(1, ge=1),
            page_size: int = Query(PREVIEW_PAGE_SIZE, ge=1, le=500),
            search: Optional[str] = Query(None),
            sort_by: Optional[str] = Query(None),
            sort_dir: str = Query("asc", pattern="^(asc|desc)$")):
    df = _require_df(dataset_id)

    if search:
        mask = df.apply(
            lambda row: row.astype(str).str.contains(search, case=False, na=False).any(),
            axis=1,
        )
        df = df[mask]

    if sort_by and sort_by in df.columns:
        df = df.sort_values(by=sort_by, ascending=(sort_dir != "desc"),
                            na_position="last")

    total = len(df)
    start = (page - 1) * page_size
    page_df = df.iloc[start:start + page_size]

    columns = [{"name": c, "dtype": column_dtype(df[c])} for c in df.columns]
    return {
        "columns": columns,
        "rows": df_to_records(page_df),
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": max(1, math.ceil(total / page_size)),
    }


@app.get("/datasets/{dataset_id}/stats")
def stats(dataset_id: str):
    df = _require_df(dataset_id)
    return profiling.profile(df)


@app.get("/datasets/{dataset_id}/profile")
def profile_detailed(dataset_id: str):
    df = _require_df(dataset_id)
    return enterprise_profiler.profile_dataset(df)


@app.get("/datasets/{dataset_id}/validate")
def validate(dataset_id: str):
    df = _require_df(dataset_id)
    return {"issues": profiling.validate(df)}


@app.get("/datasets/{dataset_id}/enterprise-validate")
def enterprise_validate(dataset_id: str):
    df = _require_df(dataset_id)
    return smart_cleaning.validate_dataset(df).to_dict()


# ---------------------------------------------------------------- cleaning
@app.post("/datasets/{dataset_id}/clean")
def clean(dataset_id: str, req: OperationRequest):
    df = _require_df(dataset_id)
    try:
        new_df, message = cleaning.apply_operation(df, req.operation, req.params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    meta = store.update_df(dataset_id, new_df)
    query_cache.invalidate_dataset(dataset_id)
    return {"message": message, "meta": meta.to_dict()}


@app.post("/datasets/{dataset_id}/auto-clean")
def auto_clean(dataset_id: str):
    df = _require_df(dataset_id)
    new_df, log = cleaning.auto_clean(df)
    meta = store.update_df(dataset_id, new_df)
    query_cache.invalidate_dataset(dataset_id)
    return {"log": log, "meta": meta.to_dict()}


# ---------------------------------------------------------------- smart cleaning (enterprise)
@app.post("/datasets/{dataset_id}/smart-clean")
def smart_clean(dataset_id: str, req: SmartCleanRequest):
    df = _require_df(dataset_id)
    result = smart_cleaning.auto_clean_v2(df)
    _store_audit_log(dataset_id, result.to_dict()["audit_log"])
    if not req.dry_run and not result.halted:
        meta = store.update_df(dataset_id, result.df)
        query_cache.invalidate_dataset(dataset_id)
        return {**result.to_dict(), "meta": meta.to_dict()}
    return result.to_dict()


@app.get("/datasets/{dataset_id}/audit-log")
def get_audit_log(dataset_id: str):
    """Return the audit log for the last smart-clean operation (stored in memory)."""
    log = _audit_logs.get(dataset_id, [])
    return {"audit_log": log}


@app.delete("/datasets/{dataset_id}/audit-log")
def clear_audit_log(dataset_id: str):
    _audit_logs.pop(dataset_id, None)
    return {"status": "ok"}


@app.get("/datasets/{dataset_id}/fuzzy-duplicates")
def fuzzy_duplicates(dataset_id: str, threshold: float = Query(0.85, ge=0.0, le=1.0)):
    df = _require_df(dataset_id)
    return smart_cleaning.detect_fuzzy_duplicates(df, threshold=threshold).to_dict()


@app.get("/datasets/{dataset_id}/outlier-report")
def outlier_report(dataset_id: str):
    df = _require_df(dataset_id)
    return smart_cleaning.outlier_report(df).to_dict()


@app.get("/operations")
def list_operations():
    return {"operations": sorted(cleaning.OPERATIONS.keys())}


# ---------------------------------------------------------------- analytics
@app.post("/datasets/{dataset_id}/analytics")
def run_analytics(dataset_id: str, req: AnalyticsRequest):
    df = _require_df(dataset_id)
    if req.kind == "histogram" and req.column:
        return analytics.histogram(df, req.column, req.bins or 20)
    if req.kind == "value_counts" and req.column:
        return analytics.value_counts(df, req.column)
    if req.kind == "correlation":
        return analytics.correlation(df)
    if req.kind == "aggregate" and req.group_by and req.metric:
        return analytics.aggregate(df, req.group_by, req.metric, req.agg or "sum")
    if req.kind == "overview":
        return analytics.overview(df)
    raise HTTPException(status_code=400, detail="Invalid analytics request")


@app.get("/datasets/{dataset_id}/overview")
def overview(dataset_id: str):
    df = _require_df(dataset_id)
    return analytics.overview(df)


# ---------------------------------------------------------------- AI chat
@app.post("/datasets/{dataset_id}/chat")
def chat(dataset_id: str, req: ChatRequest):
    df = _require_df(dataset_id)
    return ai_chat.handle(df, req.message)


# ---------------------------------------------------------------- export
def _safe_filename(name: str) -> str:
    cleaned = "".join(c if c.isalnum() or c in (" ", "-", "_") else "_" for c in name)
    return cleaned.strip().replace(" ", "_") or "dataset"


# ---------------------------------------------------------------- SQL
@app.post("/datasets/{dataset_id}/sql")
def run_sql(dataset_id: str, req: SqlRequest):
    df = _require_df(dataset_id)
    try:
        meta = store.get_meta(dataset_id)
        return sql.run_query(dataset_id, df, req.query, req.limit, meta.name)
    except SqlError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/cache/stats")
def cache_stats():
    return query_cache.stats()


# ---------------------------------------------------------------- export
@app.get("/datasets/{dataset_id}/export")
def export_dataset(dataset_id: str, format: str = Query("csv", pattern="^(csv|json|xlsx|excel)$")):
    df = _require_df(dataset_id)
    base = _safe_filename(store.get_meta(dataset_id).name)
    fmt = format.lower()

    if fmt == "csv":
        payload = df.to_csv(index=False).encode("utf-8")
        media, filename = "text/csv", f"{base}.csv"
    elif fmt == "json":
        payload = df.to_json(orient="records", indent=2).encode("utf-8")
        media, filename = "application/json", f"{base}.json"
    elif fmt in ("excel", "xlsx"):
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Data")
        payload = buf.getvalue()
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"{base}.xlsx"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported export format '{format}'")

    return StreamingResponse(
        io.BytesIO(payload),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ------------------------------------------------------------------ ml
@app.post("/datasets/{dataset_id}/ml/train")
def train_model(dataset_id: str, req: MLTrainRequest):
    df = _require_df(dataset_id)
    try:
        result = ml.train(
            df,
            target=req.target,
            features=req.features,
            task=req.task,
            model_type=req.model_type,
            test_size=req.test_size,
        )
        pipeline = result.pop("pipeline")
        store.set_model(dataset_id, result["model_id"], pipeline, result)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Training failed: {e}")


@app.post("/datasets/{dataset_id}/ml/predict")
def predict_model(dataset_id: str, req: MLPredictRequest):
    df = _require_df(dataset_id)
    pipeline = store.get_model(dataset_id, req.model_id)
    if pipeline is None:
        raise HTTPException(status_code=404, detail="Model not found")
    try:
        out_df = ml.predict(df, req.model_id, pipeline)
        return {
            "rows": int(out_df.shape[0]),
            "columns": out_df.columns.tolist(),
            "predictions": df_to_records(out_df),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")


@app.get("/datasets/{dataset_id}/ml/models")
def list_models(dataset_id: str):
    _require_df(dataset_id)  # ensure dataset exists
    return store.list_models(dataset_id)


@app.delete("/datasets/{dataset_id}/ml/models/{model_id}")
def delete_model(dataset_id: str, model_id: str):
    _require_df(dataset_id)
    store.delete_model(dataset_id, model_id)
    return {"deleted": True}


# ------------------------------------------------------------------ report
@app.get("/datasets/{dataset_id}/report")
def get_report(dataset_id: str):
    df = _require_df(dataset_id)
    meta = store.get_meta(dataset_id).to_dict()
    return report.build(df, meta)


@app.get("/datasets/{dataset_id}/report/download")
def download_report(dataset_id: str):
    df = _require_df(dataset_id)
    meta = store.get_meta(dataset_id).to_dict()
    payload = report.render_html(report.build(df, meta))
    base = _safe_filename(meta.get("name") or "dataset")
    return StreamingResponse(
        io.BytesIO(payload.encode("utf-8")),
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{base}_report.html"'},
    )


# ----------------------------------------------------------- enterprise report
@app.get("/datasets/{dataset_id}/enterprise-report")
def get_enterprise_report(dataset_id: str):
    df = _require_df(dataset_id)
    meta = store.get_meta(dataset_id).to_dict()
    audit_log = _audit_logs.get(dataset_id, [])
    return enterprise_report.build_enterprise_report(df, meta, audit_log)


@app.get("/datasets/{dataset_id}/enterprise-report/download")
def download_enterprise_report(dataset_id: str, format: str = Query("html", pattern="^(html|xlsx)$")):
    df = _require_df(dataset_id)
    meta = store.get_meta(dataset_id).to_dict()
    audit_log = _audit_logs.get(dataset_id, [])
    base = _safe_filename(meta.get("name") or "dataset")
    rpt = enterprise_report.build_enterprise_report(df, meta, audit_log)

    if format.lower() == "xlsx":
        payload = enterprise_report.export_excel_multi_sheet(df, meta, audit_log, report=rpt)
        return StreamingResponse(
            io.BytesIO(payload),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{base}_enterprise_report.xlsx"'},
        )
    else:
        payload = enterprise_report.render_enterprise_html(rpt)
        return StreamingResponse(
            io.BytesIO(payload.encode("utf-8")),
            media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="{base}_enterprise_report.html"'},
        )


# ------------------------------------------------------------------ forecast
@app.post("/datasets/{dataset_id}/forecast")
def run_forecast(dataset_id: str, req: ForecastRequest):
    df = _require_df(dataset_id)
    try:
        return forecast.forecast(df, req.date_col, req.target_col, req.method, req.horizon)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------------ insights
@app.get("/datasets/{dataset_id}/insights")
def get_insights(dataset_id: str, max_insights: int = Query(12, ge=1, le=50)):
    df = _require_df(dataset_id)
    return insights.generate(df, max_insights=max_insights)


# ------------------------------------------------------------------ join
@app.post("/datasets/{dataset_id}/join")
def join_datasets(dataset_id: str, req: JoinRequest):
    _require_df(dataset_id)
    try:
        _require_df(req.right_id)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Right dataset not found")
    try:
        return join.join_datasets(
            left_id=dataset_id,
            right_id=req.right_id,
            left_on=req.left_on,
            right_on=req.right_on,
            how=req.how,
            suffixes=req.suffixes,
            name=req.name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except KeyError:
        raise HTTPException(status_code=404, detail="Dataset not found")


# ------------------------------------------------------------------ cluster
@app.post("/datasets/{dataset_id}/ml/cluster")
def cluster_dataset(dataset_id: str, req: ClusterRequest):
    df = _require_df(dataset_id)
    try:
        result = ml.cluster(
            df,
            features=req.features,
            n_clusters=req.n_clusters,
            apply=req.apply,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clustering failed: {e}")

    if req.apply and "df" in result:
        new_df = result.pop("df")
        meta = store.update_df(dataset_id, new_df)
        query_cache.invalidate_dataset(dataset_id)
        result["meta"] = meta.to_dict()
    return result
