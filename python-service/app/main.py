"""DataForge AI — FastAPI data engine."""
from __future__ import annotations

import io
import math
from typing import Optional

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .cache import query_cache
from .config import CORS_ORIGINS, PREVIEW_PAGE_SIZE
from .dask_loader import load_dask_dataframe
from .loader import UnsupportedFileError, load_dataframe
from .polars_loader import load_polars_dataframe, polars_to_pandas
from .schemas import AnalyticsRequest, ChatRequest, ForecastRequest, MLPredictRequest, MLTrainRequest, OperationRequest, SqlRequest
from .services import ai_chat, analytics, cleaning, forecast, ml, profiling, report, sql
from .services.sql import SqlError
from .store import store
from .utils import column_dtype, df_to_records

app = FastAPI(title="DataForge AI — Data Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
            sort_dir: str = Query("asc")):
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


@app.get("/datasets/{dataset_id}/validate")
def validate(dataset_id: str):
    df = _require_df(dataset_id)
    return {"issues": profiling.validate(df)}


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
def export_dataset(dataset_id: str, format: str = Query("csv")):
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


# ------------------------------------------------------------------ forecast
@app.post("/datasets/{dataset_id}/forecast")
def run_forecast(dataset_id: str, req: ForecastRequest):
    df = _require_df(dataset_id)
    try:
        return forecast.forecast(df, req.date_col, req.target_col, req.method, req.horizon)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
