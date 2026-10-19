# mendii-shoe

운동화 사진으로 밑창·뒤꿈치 안감 손상을 판정하는 웹 서비스입니다.

## 실행 (프로젝트 루트)

Python 3.10 이상을 사용하세요. 모델 가중치 3개와 `config.json`은 `model/`에 있어야 합니다.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r model/requirements.txt
python -m uvicorn server:app --app-dir model --host 0.0.0.0 --port 8000
```

브라우저에서 http://localhost:8000 을 열면 프론트와 모델 API를 함께 사용할 수 있습니다. 처음 실행 시 모델 로딩·워밍업을 기다려 주세요. 서버 상태는 http://localhost:8000/health 에서 확인합니다.

프론트를 따로 실행하려면 `python3 -m http.server 5173 --directory frontend` 후 http://localhost:5173 을 여세요. 이 경우 같은 컴퓨터의 8000번 모델 서버에 연결됩니다. `index.html`을 파일로 직접 여는 방식은 지원하지 않습니다.

## 분석 연결

- 원본 `File`을 수정 없이 `POST /predict`의 multipart `file` 필드로 보냅니다. 프론트에서 리사이즈·회전·재인코딩하지 않습니다.
- 최종 결과는 서버의 `prediction`을 그대로 표시합니다: `정상`, `outsole`, `heel lining`, `outsole + heel lining`.
- 부위별 판정은 `results`의 `verdict`를 표시합니다. 프론트에서 임계값을 재계산하지 않습니다.
- 현재 API 응답에는 좌표가 없어 손상 위치 박스는 표시하지 않습니다.
- 요청 실패 시 사진 확인 화면에서 재시도할 수 있습니다. 분석 중 홈으로 이동하면 요청을 취소하고, 이전 응답은 무시합니다. 요청 제한 시간은 120초입니다.
- 모델 사양·전처리·고정 Ultralytics 버전은 [모델 README](model/README.md)를 참고하세요.

## 프론트 연결 테스트

Node.js 20 이상에서 실행합니다.

```sh
node --test tests/frontend.test.cjs
```

원본 파일 전달, 네 가지 최종 판정 표시, 연결 실패·응답 오류·취소를 검사합니다.

실제 모델 로딩·원본 사진 추론·프론트 제공·CORS·잘못된 파일 응답까지 확인하려면:

```sh
.venv/bin/python tests/model_integration.py
```

## GitHub Pages + Colab

- `.github/workflows/pages.yml`은 `frontend/`만 GitHub Pages에 배포합니다. 저장소 Settings → Pages → Source를 GitHub Actions로 설정하세요.
- `frontend/config.js`의 `apiOrigin`을 본인 Colab ngrok HTTPS 주소로 설정하세요. 토큰은 넣지 않습니다.
- 모델 서버는 `https://ddoguma.github.io` 출처와 `ngrok-skip-browser-warning` 헤더를 허용해야 합니다. Colab에 복사한 서버 파일에도 이 설정을 적용하고 서버를 재시작하세요.
- 로컬 실행은 기존대로 같은 서버 또는 localhost:8000 API를 사용합니다.
