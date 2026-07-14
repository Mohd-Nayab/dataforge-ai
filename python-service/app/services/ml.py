"""Lightweight ML training/prediction service using scikit-learn."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import accuracy_score, mean_absolute_error, mean_squared_error, r2_score, silhouette_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from ..store import store

Result = Tuple[Any, str]

VALID_TASKS = {"regression", "classification"}
MODEL_MAP = {
    "linear_regression": LinearRegression,
    "logistic_regression": LogisticRegression,
    "random_forest_regressor": RandomForestRegressor,
    "random_forest_classifier": RandomForestClassifier,
}


def _infer_task(df: pd.DataFrame, target: str) -> str:
    if pd.api.types.is_numeric_dtype(df[target]):
        unique = df[target].dropna().nunique()
        if unique <= 10:
            return "classification"
        return "regression"
    return "classification"


def _resolve_model(task: str, model_type: str | None) -> Any:
    if model_type:
        return MODEL_MAP[model_type]
    if task == "regression":
        return RandomForestRegressor(n_estimators=100, random_state=42)
    return RandomForestClassifier(n_estimators=100, random_state=42)


def _prepare_xy(df: pd.DataFrame, target: str, features: List[str] | None):
    cols = [c for c in (features or df.columns.tolist()) if c != target]
    if target not in df.columns:
        raise ValueError(f"Target column '{target}' not found.")
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"Feature columns not found: {', '.join(missing)}")

    X = df[cols].copy()
    y = df[target].copy()

    # Drop rows where target is missing.
    mask = y.notna()
    X = X[mask]
    y = y[mask]

    numeric = X.select_dtypes(include=[np.number]).columns.tolist()
    categorical = [c for c in cols if c not in numeric]

    # Normalise categorical columns to plain Python strings, replacing any
    # missing values with a sentinel so OneHotEncoder never receives a mix of
    # pd.NA / None and str values.
    for col in categorical:
        X[col] = X[col].astype("object").where(X[col].notna(), "__missing__").astype(str)

    numeric_pipe = Pipeline([
        ("impute", SimpleImputer(strategy="median")),
        ("scale", StandardScaler()),
    ])
    categorical_pipe = Pipeline([
        ("encode", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ])

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_pipe, numeric),
            ("cat", categorical_pipe, categorical),
        ]
    )
    return X, y, numeric, categorical, preprocessor, cols


def train(
    df: pd.DataFrame,
    target: str,
    features: List[str] | None = None,
    task: str | None = None,
    model_type: str | None = None,
    test_size: float = 0.2,
) -> Dict[str, Any]:
    if not task:
        task = _infer_task(df, target)
    if task not in VALID_TASKS:
        raise ValueError(f"task must be one of {VALID_TASKS}")

    X, y, numeric, categorical, preprocessor, feature_cols = _prepare_xy(df, target, features)

    if len(X) < 5:
        raise ValueError("Dataset is too small to train a model (need at least 5 rows).")

    model = _resolve_model(task, model_type)
    pipeline = Pipeline([("preprocess", preprocessor), ("model", model)])

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=42, stratify=y if task == "classification" else None
    )
    pipeline.fit(X_train, y_train)
    y_pred = pipeline.predict(X_test)

    metrics: Dict[str, float] = {}
    if task == "regression":
        metrics = {
            "r2": float(r2_score(y_test, y_pred)),
            "mae": float(mean_absolute_error(y_test, y_pred)),
            "rmse": float(np.sqrt(mean_squared_error(y_test, y_pred))),
        }
    else:
        metrics = {
            "accuracy": float(accuracy_score(y_test, y_pred)),
        }

    model_id = uuid.uuid4().hex[:12]
    return {
        "model_id": model_id,
        "task": task,
        "target": target,
        "features": feature_cols,
        "numeric_features": numeric,
        "categorical_features": categorical,
        "test_size": test_size,
        "rows_used": int(len(X)),
        "metrics": metrics,
        "pipeline": pipeline,
    }


def predict(df: pd.DataFrame, model_id: str, model: Any) -> pd.DataFrame:
    if not hasattr(model, "predict"):
        raise ValueError("Invalid model object")
    # Use the same feature columns as the pipeline expects.
    feature_cols = list(model.feature_names_in_) if hasattr(model, "feature_names_in_") else df.columns.tolist()
    missing = [c for c in feature_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing features for prediction: {', '.join(missing)}")
    X = df[feature_cols].copy()

    # Apply the same categorical normalisation used during training so the
    # fitted OneHotEncoder receives consistent string inputs.
    categorical = [c for c in feature_cols if c not in X.select_dtypes(include=[np.number]).columns]
    for col in categorical:
        X[col] = X[col].astype("object").where(X[col].notna(), "__missing__").astype(str)

    preds = model.predict(X)
    out = df.copy()
    out["prediction"] = preds


def cluster(
    df: pd.DataFrame,
    features: List[str] | None = None,
    n_clusters: int = 3,
    apply: bool = False,
) -> Dict[str, Any]:
    """Run K-Means on numeric features. Optionally attach cluster labels to a copy."""
    if n_clusters < 2 or n_clusters > 20:
        raise ValueError("n_clusters must be between 2 and 20.")

    if features:
        missing = [c for c in features if c not in df.columns]
        if missing:
            raise ValueError(f"Feature columns not found: {', '.join(missing)}")
        cols = [c for c in features if pd.api.types.is_numeric_dtype(df[c])]
    else:
        cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]

    if len(cols) < 1:
        raise ValueError("Need at least one numeric feature for clustering.")

    X = df[cols].copy()
    mask = X.notna().all(axis=1)
    X = X[mask]
    if len(X) < n_clusters:
        raise ValueError(f"Need at least {n_clusters} complete rows for clustering.")

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)
    model = KMeans(n_clusters=n_clusters, n_init=10, random_state=42)
    labels = model.fit_predict(Xs)

    sil = None
    if n_clusters < len(X) and len(set(labels)) > 1:
        try:
            sil = float(silhouette_score(Xs, labels))
        except Exception:
            sil = None

    counts = {int(k): int(v) for k, v in zip(*np.unique(labels, return_counts=True))}
    centers = []
    for i, center in enumerate(model.cluster_centers_):
        # Inverse-transform centers back to original scale for readability.
        original = scaler.inverse_transform(center.reshape(1, -1))[0]
        centers.append({
            "cluster": i,
            "size": counts.get(i, 0),
            "means": {col: float(original[j]) for j, col in enumerate(cols)},
        })

    result: Dict[str, Any] = {
        "n_clusters": n_clusters,
        "features": cols,
        "rows_used": int(len(X)),
        "inertia": float(model.inertia_),
        "silhouette": sil,
        "cluster_sizes": counts,
        "centers": centers,
        "applied": False,
        "sample_labels": [int(x) for x in labels[:20]],
    }

    if apply:
        out = df.copy()
        out["cluster"] = np.nan
        out.loc[mask, "cluster"] = labels
        out["cluster"] = out["cluster"].astype("Int64")
        result["df"] = out
        result["applied"] = True

    return result
    return out
