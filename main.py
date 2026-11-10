# RythuVoice – Stage 6: FastAPI Backend + Gnani Prisma STT + Telugu FAQ Matching
# Receives audio, transcribes via Gnani Prisma, then matches the transcript
# against a local FAQ list and returns the best answer.

import os
import json
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# --- Step 1: Load the secret API key from the .env file ---
# This ensures sensitive credentials are never placed in the code or exposed to browsers.
load_dotenv(override=True)   # override=True ensures .env always wins over stale OS env vars
GNANI_API_KEY = os.getenv("GNANI_API_KEY")

# --- Step 2: Gnani Prisma API Specifications (Official Documentation) ---
# Base URL: https://api.vachana.ai
# REST Endpoint: /stt/v3
GNANI_API_URL = "https://api.vachana.ai/stt/v3"

# --- Step 3: Load FAQ data once when the server starts ---
# faq.json lives in the same folder as main.py
FAQ_FILE = os.path.join(os.path.dirname(__file__), "faq.json")
with open(FAQ_FILE, encoding="utf-8") as f:
    FAQ_LIST = json.load(f)

# --- Step 4: FAQ keyword matching function ---
# Goes through each FAQ entry and checks if any keyword appears in the transcript.
# Returns the matched entry, or None if nothing matches.
def find_faq_match(transcript):
    # Convert transcript to lowercase once for all comparisons
    transcript_lower = transcript.lower()

    for entry in FAQ_LIST:
        for keyword in entry["keywords"]:
            if keyword.lower() in transcript_lower:
                return entry   # Found a match — return this FAQ entry

    return None   # No keyword matched

# --- Step 5: Initialize FastAPI application ---
app = FastAPI(title="RythuVoice API", version="2.0")

# --- Step 6: Configure CORS ---
# Allows browser frontends running on Netlify, Live Server, or local ports to communicate with FastAPI.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://elegant-salmiakki-97d25e.netlify.app",
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supported audio MIME types for upload and browser recording
ALLOWED_TYPES = [
    "audio/webm",
    "audio/wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/ogg",
    "audio/mp4",
    "audio/x-wav",
]


# --- Endpoint 1: GET / ---
# Confirms backend service is running
@app.get("/")
def root():
    return {"message": "RythuVoice backend is running."}


# --- Endpoint 2: GET /health ---
# Health check endpoint that also inspects if a real API key is configured
@app.get("/health")
def health():
    key_loaded = bool(GNANI_API_KEY and GNANI_API_KEY.strip() != "your_gnani_api_key_here")
    return {
        "status": "ok",
        "service": "RythuVoice",
        "gnani_key_configured": key_loaded,
    }


# --- Endpoint 3: POST /upload-audio ---
# Accepts an audio recording/file, sends it to Gnani Prisma, and returns the Telugu transcript.
@app.post("/upload-audio")
async def upload_audio(file: UploadFile = File(...)):

    # 1. Verify file was provided
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    # 2. Validate audio content type
    content_type = file.content_type or ""
    if not content_type.startswith("audio/") and content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: '{content_type}'. Please upload an audio file."
        )

    # 3. Read audio bytes into memory (avoids storing unnecessary files to disk)
    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # 4. Verify that Gnani API key has been configured
    if not GNANI_API_KEY or GNANI_API_KEY.strip() == "your_gnani_api_key_here":
        raise HTTPException(
            status_code=500,
            detail="Gnani API key is not configured. Please add your key to GNANI_API_KEY in the .env file."
        )

    # 5. Call Gnani Prisma STT API
    # Headers: X-API-Key-ID: <key>
    # Form data: model=prisma-v3.0, language_code=te-IN, format=transcribe
    try:
        gnani_response = requests.post(
            url=GNANI_API_URL,
            headers={
                "X-API-Key-ID": GNANI_API_KEY.strip(),
            },
            files={
                "audio_file": (file.filename, audio_bytes, content_type),
            },
            data={
                "model": "prisma-v3.0",
                "language_code": "te-IN",    # Telugu (India)
                "format": "transcribe",      # Clean text output with Inverse Text Normalization
            },
            timeout=60,
        )

    except requests.exceptions.Timeout:
        raise HTTPException(
            status_code=504,
            detail="Gnani API did not respond in time (Timeout). Please try again."
        )
    except requests.exceptions.ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Could not connect to Gnani API. Please check your internet connection."
        )

    # 6. Check response status codes from Gnani
    if gnani_response.status_code == 401:
        raise HTTPException(status_code=401, detail="Gnani API key is unauthorized or invalid.")
    elif gnani_response.status_code != 200:
        # Extract Gnani's exact error message if available
        try:
            err_json = gnani_response.json()
            err_detail = err_json.get("error", {}).get("message") or err_json.get("message") or gnani_response.text
        except Exception:
            err_detail = gnani_response.text
        raise HTTPException(
            status_code=502,
            detail=f"Gnani API error ({gnani_response.status_code}): {err_detail}"
        )

    # 7. Parse Gnani JSON response
    result = gnani_response.json()

    if not result.get("success"):
        error_info = result.get("error", {})
        err_msg = error_info.get("message", "Transcription failed.")
        raise HTTPException(
            status_code=502,
            detail=f"Gnani transcription failed: {err_msg}"
        )

    transcript = result.get("transcript", "")

    # 9. Run FAQ keyword matching on the transcript
    matched = find_faq_match(transcript)

    if matched:
        faq_question = matched["question"]
        faq_answer   = matched["answer"]
        faq_found    = True
    else:
        # No FAQ matched — give a safe, honest fallback message
        faq_question = None
        faq_answer   = "మీ ప్రశ్నకు సమాధానం మా జాబితాలో లేదు. దయచేసి మీ స్థానిక వ్యవసాయ అధికారిని సంప్రదించండి. (Your question was not found in our list. Please contact your local agriculture officer.)"
        faq_found    = False

    # 10. Return the transcript, FAQ match and metadata
    return {
        "success": True,
        "transcript": transcript,
        "detected_language": result.get("detected_language_code", "te-IN"),
        "faq_found": faq_found,
        "faq_question": faq_question,
        "faq_answer": faq_answer,
        "filename": file.filename,
        "size_bytes": len(audio_bytes),
    }
