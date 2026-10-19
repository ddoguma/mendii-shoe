"""Mendii 신발 손상 판정 API (FastAPI).

실행:  MODEL_DIR=. uvicorn server:app --host 0.0.0.0 --port 8000
  GET  /health               서버·모델 상태
  POST /predict  (file=이미지, multipart/form-data, 쿼리 threshold=0.5 선택)
응답 형식은 교수님 테스트 프로그램(app.py)과 호환됩니다. 최종 답은 응답의 "prediction"과
results[0](종합 판정)의 finding에 있습니다.
"""
import os
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from predictor import ShoeDamagePredictor, to_app_response

app = FastAPI(title='Mendii Shoe Damage API')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173', 'https://ddoguma.github.io'],
    allow_methods=['POST', 'GET'],
    allow_headers=['Content-Type', 'ngrok-skip-browser-warning'],
)
PRED = ShoeDamagePredictor(os.environ.get('MODEL_DIR', os.path.dirname(os.path.abspath(__file__))))


@app.get('/health')
def health():
    import torch
    return dict(status='ok', task='신발 손상 판정 (outsole / heel lining)',
                models=[m['experiment'] for m in PRED.cfg['members']],
                thresholds=PRED.th, device='cuda' if torch.cuda.is_available() else 'cpu')


@app.post('/predict')
def predict(file: UploadFile = File(...), threshold: float = Query(0.5, ge=0.01, le=0.99)):
    # species, include_us 등 app.py가 보내는 다른 쿼리 값은 무시합니다.
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail='빈 파일입니다.')
    try:
        out = PRED.predict_bytes(data)
    except Exception as exc:   # 이미지가 아니거나 손상된 파일
        raise HTTPException(status_code=400, detail=f'이미지를 읽을 수 없습니다: {exc}')
    return to_app_response(out, threshold)


# API 경로보다 뒤에 등록해 같은 서버에서 프론트엔드도 제공합니다.
frontend_dir = Path(__file__).resolve().parent.parent / 'frontend'
if frontend_dir.is_dir():
    app.mount('/', StaticFiles(directory=str(frontend_dir), html=True), name='frontend')
