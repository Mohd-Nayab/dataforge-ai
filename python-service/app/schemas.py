from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class OperationRequest(BaseModel):
    operation: str
    params: Dict[str, Any] = {}


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)


class AnalyticsRequest(BaseModel):
    kind: str  # histogram | value_counts | correlation | aggregate | overview
    column: Optional[str] = None
    group_by: Optional[str] = None
    metric: Optional[str] = None
    agg: Optional[str] = "sum"
    bins: Optional[int] = Field(20, ge=1, le=200)


class SqlRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=5000)
    limit: int = Field(1000, ge=1, le=5000)


class MLTrainRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    target: str
    features: Optional[List[str]] = None
    task: Optional[str] = None  # regression | classification
    model_type: Optional[str] = None
    test_size: float = Field(0.2, gt=0, lt=1)


class MLPredictRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model_id: str


class ForecastRequest(BaseModel):
    date_col: Optional[str] = None
    target_col: Optional[str] = None
    method: str = "linear"  # linear | moving_average | seasonal_naive
    horizon: int = Field(7, ge=1, le=365)


class SmartCleanRequest(BaseModel):
    steps: Optional[List[str]] = None  # if None, run full pipeline
    columns: Optional[List[str]] = None
    dry_run: bool = False


class JoinRequest(BaseModel):
    right_id: str
    left_on: str
    right_on: str
    how: str = "inner"  # inner | left | right | outer
    suffixes: Optional[List[str]] = None
    name: Optional[str] = None


class ClusterRequest(BaseModel):
    features: Optional[List[str]] = None
    n_clusters: int = Field(3, ge=2, le=20)
    apply: bool = False
