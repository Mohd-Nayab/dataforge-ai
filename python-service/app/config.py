import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

PREVIEW_PAGE_SIZE = int(os.getenv("PREVIEW_PAGE_SIZE", "50"))
MAX_PREVIEW_ROWS = int(os.getenv("MAX_PREVIEW_ROWS", "1000"))

# Optional Ollama integration for the AI chat assistant.
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4000",
).split(",")
