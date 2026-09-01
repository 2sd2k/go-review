from fastapi import APIRouter, UploadFile, HTTPException

router = APIRouter()
MAX_SGF_BYTES = 5 * 1024 * 1024


@router.post("/api/upload-sgf")
async def upload_sgf(file: UploadFile):
    """Upload and validate an SGF file. Returns the raw SGF text."""
    if not file.filename or not file.filename.lower().endswith(".sgf"):
        raise HTTPException(status_code=400, detail="File must be an .sgf file")

    content = await file.read()
    if len(content) > MAX_SGF_BYTES:
        raise HTTPException(status_code=413, detail="SGF file must be 5 MB or smaller")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        # Try latin-1 as fallback (some older SGF files)
        text = content.decode("latin-1")

    # Basic validation — SGF must start with (;
    stripped = text.strip()
    if not stripped.startswith("(;"):
        raise HTTPException(status_code=400, detail="Invalid SGF format")

    return {"sgf": text, "filename": file.filename}
