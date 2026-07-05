from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict


class OperationRequest(BaseModel):
    operation: str
    params: Dict[str, Any] = {}


class ChatRequest(BaseModel):
    message: str


class AnalyticsRequest(BaseModel):
    kind: str  # histogram | value_counts | correlation | aggregate | overview
    column: Optional[str] = None
    group_by: Optional[str] = None
    metric: Optional[str] = None
    agg: Optional[str] = "sum"
    bins: Optional[int] = 20


class SqlRequest(BaseModel):
    query: str
    limit: int = 1000


class MLTrainRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    target: str
    features: Optional[List[str]] = None
    task: Optional[str] = None  # regression | classification
    model_type: Optional[str] = None
    test_size: float = 0.2


class MLPredictRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model_id: str


class ForecastRequest(BaseModel):
    date_col: Optional[str] = None
    target_col: Optional[str] = None
    method: str = "linear"  # linear | moving_average | seasonal_naive
    horizon: int = 7
