import os
import shutil

# KataGo binary — check common install locations
KATAGO_BINARY = os.environ.get("KATAGO_BINARY", shutil.which("katago") or "katago")

# KataGo model file
KATAGO_MODEL = os.environ.get(
    "KATAGO_MODEL",
    "/opt/homebrew/share/katago/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz"
)

# KataGo config file for analysis
KATAGO_CONFIG = os.environ.get(
    "KATAGO_CONFIG",
    "/opt/homebrew/share/katago/configs/analysis_example.cfg"
)

# Analysis settings
DEFAULT_MAX_VISITS = int(os.environ.get("KATAGO_MAX_VISITS", "100"))
DEFAULT_RULES = os.environ.get("KATAGO_RULES", "chinese")
DEFAULT_KOMI = float(os.environ.get("KATAGO_KOMI", "7.5"))

# The API normalizes all engine values to Black's perspective. Force the
# engine output to match instead of depending on a user's KataGo config.
KATAGO_REPORT_PERSPECTIVE = "BLACK"

# Server settings
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")
    if origin.strip()
]
