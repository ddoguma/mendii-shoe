# Mendii 신발 손상 판정 모델 패키지

신발 사진 한 장을 넣으면 **정상 / outsole / heel lining / outsole + heel lining** 중 하나로 판정합니다.
YOLO 모델 여러 개의 점수를 평균하는 앙상블이며, 모델 목록·임계값·전처리 설정은 모두 `config.json`에 들어 있습니다.

## 파일
| 파일 | 내용 |
|---|---|
| `model*.pt` | 학습된 YOLO 가중치 (앙상블 구성원) |
| `config.json` | 구성원 목록, 각 모델 입력 크기, 판정 임계값, 전처리 설정 |
| `predictor.py` | 판정기 `ShoeDamagePredictor` (전처리 → 모델별 점수 → 평균 → 판정) |
| `server.py` | FastAPI 서버 (`/health`, `/predict`) |
| `requirements.txt` | 학습 때와 같은 Ultralytics 버전 고정 |

## 실행
```bash
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000
# 외부 공개가 필요하면: ngrok http 8000
```
서버가 켜질 때 모델을 한 번만 불러오고 워밍업합니다. 요청마다 모델을 다시 불러오지 마세요.

## API
- `GET /health` → `{"status": "ok", "models": [...], "thresholds": {...}, "device": "cuda"}`
- `POST /predict` (multipart/form-data, 필드 이름 **`file`**) → 판정 결과 JSON
  - 선택 쿼리 `threshold` (기본 0.5, 보정 점수 기준). **바꾸지 마세요.** 0.5가 검증 데이터로 고른 기준입니다.

응답 예시
```json
{
  "prediction": "outsole",
  "results": [
    {"label": "종합 판정", "disease": "overall", "verdict": "의심", "abnormal": 0.5158, "finding": "outsole", "finding_prob": 0.5158},
    {"label": "밑창 손상 (outsole)", "disease": "outsole", "verdict": "의심", "abnormal": 0.5158, "finding": "outsole", "finding_prob": 0.08},
    {"label": "안감 손상 (heel lining)", "disease": "heel_lining", "verdict": "정상", "abnormal": 0.0769, "finding": "정상", "finding_prob": 0.02}
  ],
  "count": 3, "suspect_count": 2, "threshold": 0.5,
  "scores": {"outsole": 0.08, "heel_lining": 0.02},
  "raw_thresholds": {"outsole": 0.05, "heel_lining": 0.13},
  "per_model": [...], "elapsed_ms": 150.0
}
```
- **최종 답은 `prediction`** (= `results[0].finding`).
- `abnormal`은 표시용 **보정 점수**로, 0.5 이상이면 해당 손상이 있다고 판정합니다. 원점수(`scores`)를 모델 임계값(`raw_thresholds`) 기준으로 0.5에 맞춘 값이라 판정 결과는 원점수와 같습니다.
- 수업 테스트 프로그램(`app.py`)의 결과 형식 검사를 통과하도록 맞춰져 있습니다.

## 프론트엔드·서버 담당자가 지킬 것
1. **원본 사진 파일을 그대로 보내세요.** 프론트에서 리사이즈·회전·캔버스 재인코딩을 하지 마세요. 사진의 약 절반에 EXIF 회전 정보가 있고, 서버가 이 정보로 방향을 맞춥니다(학습 때와 동일). 재인코딩하면 회전 정보가 사라지거나 두 번 적용될 수 있습니다.
2. 판정 규칙·임계값을 프론트에서 다시 계산하지 말고 `prediction`을 그대로 표시하세요.
3. `requirements.txt`의 Ultralytics 버전을 바꾸지 마세요(YOLO26 모델은 8.4 이상 필요).
4. 동시 요청은 서버 안에서 하나씩 처리됩니다(모델 객체 보호용 잠금).

## 판정 방식 (참고)
1. 사진을 EXIF 회전 적용 → 긴 변 1280px 축소 → JPEG(품질 93)로 학습 데이터와 같은 상태로 만듭니다.
2. 각 모델을 자기 학습 해상도(`imgsz`)로 실행하고, 클래스별로 가장 높은 박스 신뢰도를 그 사진의 점수로 씁니다.
3. 모델들의 점수를 평균한 뒤 클래스별 임계값 이상이면 그 손상이 있다고 판정합니다.
4. 임계값은 검증 데이터에서 "정상·outsole·heel lining이 고르게 섞인 사진의 손상 종류를 정확히 맞힌 비율"이 가장 높도록 정했습니다.
