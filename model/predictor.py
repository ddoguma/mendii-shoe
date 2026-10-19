"""Mendii 신발 손상 판정기 (YOLO 앙상블).

노트북(Mendii_yolo11s_v5_fast.ipynb)과 똑같은 전처리·점수 계산·판정 규칙을 재현합니다.
서버/대시보드에서는 이 파일의 ShoeDamagePredictor 하나만 쓰면 됩니다.

    from predictor import ShoeDamagePredictor
    pred = ShoeDamagePredictor('패키지_폴더')          # config.json과 .pt 파일이 있는 폴더
    out = pred.predict_bytes(open('shoe.jpg', 'rb').read())
    print(out['prediction'])                           # '정상' / 'outsole' / 'heel lining' / 'outsole + heel lining'
"""
import io
import json
import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

LABELS = {(0, 0): '정상', (1, 0): 'outsole', (0, 1): 'heel lining', (1, 1): 'outsole + heel lining'}


def calibrate(score, threshold):
    """원점수를 '판정 임계값 = 0.5'가 되도록 바꾼 표시용 점수(0~1).

    판정 결과는 원점수와 똑같습니다(원점수 >= 임계값  <=>  보정 점수 >= 0.5).
    """
    score = min(max(float(score), 0.0), 1.0)
    if score < threshold:
        return 0.5 * score / threshold
    return 0.5 + 0.5 * (score - threshold) / (1.0 - threshold)


class ShoeDamagePredictor:
    def __init__(self, package_dir='.', device=None, warmup=True):
        from ultralytics import YOLO
        self.dir = Path(package_dir)
        self.cfg = json.loads((self.dir / 'config.json').read_text(encoding='utf-8'))
        th = self.cfg['thresholds']
        self.th = {'outsole': float(th['outsole']), 'heel_lining': float(th['heel lining'])}
        self.device = device
        self.models = [(YOLO(str(self.dir / m['file'])), int(m['imgsz'])) for m in self.cfg['members']]
        self.lock = threading.Lock()   # 모델 객체는 동시 호출에 안전하지 않으므로 한 번에 하나씩 처리
        if warmup:                     # 첫 요청이 느려지지 않도록 미리 한 번 실행
            self.predict_image(Image.new('RGB', (640, 480), (200, 200, 200)))

    # ---------- 1. 전처리: 학습 때와 동일 (EXIF 회전 → 긴 변 1280 → JPEG 품질 93) ----------
    def preprocess(self, data):
        max_side = int(self.cfg.get('max_side', 1280))
        with Image.open(io.BytesIO(data)) as im:
            im.draft('RGB', (max_side, max_side))
            im = ImageOps.exif_transpose(im).convert('RGB')
        im.thumbnail((max_side, max_side), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=int(self.cfg.get('jpeg_quality', 93)))
        buf.seek(0)
        return Image.open(buf).convert('RGB')

    # ---------- 2. 모델별 점수 → 평균 ----------
    def _scores(self, im):
        per_model = []
        for model, imgsz in self.models:
            r = model.predict(im, imgsz=imgsz, conf=float(self.cfg.get('conf', 0.001)),
                              iou=float(self.cfg.get('iou', 0.7)), max_det=int(self.cfg.get('max_det', 100)),
                              device=self.device, verbose=False)[0]
            s = [0.0, 0.0]   # [outsole, heel lining] = 사진 안에서 해당 클래스 박스의 최고 신뢰도
            for c, p in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist()):
                c = int(c)
                if c in (0, 1):
                    s[c] = max(s[c], float(p))
            per_model.append(s)
        return np.mean(per_model, axis=0), per_model

    # ---------- 3. 판정 ----------
    def predict_image(self, im):
        t0 = time.perf_counter()
        with self.lock:
            (so, sh), per_model = self._scores(im)
        is_o, is_h = bool(so >= self.th['outsole']), bool(sh >= self.th['heel_lining'])
        return dict(
            prediction=LABELS[(int(is_o), int(is_h))],
            outsole=is_o, heel_lining=is_h,
            scores=dict(outsole=round(float(so), 4), heel_lining=round(float(sh), 4)),
            calibrated=dict(outsole=calibrate(so, self.th['outsole']), heel_lining=calibrate(sh, self.th['heel_lining'])),
            thresholds=dict(self.th),
            per_model=[dict(experiment=m['experiment'], outsole=round(s[0], 4), heel_lining=round(s[1], 4))
                       for m, s in zip(self.cfg['members'], per_model)],
            model_ms=round((time.perf_counter() - t0) * 1000, 1),
        )

    def predict_bytes(self, data):
        t0 = time.perf_counter()
        im = self.preprocess(data)
        out = self.predict_image(im)
        out['elapsed_ms'] = round((time.perf_counter() - t0) * 1000, 1)
        return out


def to_app_response(out, threshold=0.5):
    """교수님 테스트 프로그램(app.py)의 결과 형식으로 변환.

    app.py는 results[*]에 label/disease/verdict/abnormal/finding/finding_prob이 있고,
    abnormal >= threshold(기본 0.5)이면 verdict='의심'인지 검사합니다.
    abnormal에는 '임계값=0.5'로 보정한 점수를 넣어 이 검사를 통과하게 합니다.
    """
    co, ch = out['calibrated']['outsole'], out['calibrated']['heel_lining']
    is_o, is_h = co >= threshold, ch >= threshold          # threshold=0.5면 노트북 판정과 동일
    prediction = LABELS[(int(is_o), int(is_h))]

    def row(label, disease, abnormal, finding, prob):
        return dict(label=label, disease=disease, verdict='의심' if abnormal >= threshold else '정상',
                    abnormal=round(float(abnormal), 4), finding=finding, finding_prob=round(float(prob), 4))

    overall = max(co, ch)
    results = [
        row('종합 판정', 'overall', overall, prediction, overall),
        row('밑창 손상 (outsole)', 'outsole', co, 'outsole' if is_o else '정상', out['scores']['outsole']),
        row('안감 손상 (heel lining)', 'heel_lining', ch, 'heel lining' if is_h else '정상', out['scores']['heel_lining']),
    ]
    return dict(
        prediction=prediction,                     # 최종 답: 정상 / outsole / heel lining / outsole + heel lining
        results=results, count=len(results),
        suspect_count=sum(r['verdict'] == '의심' for r in results),
        threshold=threshold,
        scores=out['scores'], raw_thresholds=out['thresholds'],
        per_model=out['per_model'], elapsed_ms=out.get('elapsed_ms'),
    )
