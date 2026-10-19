"""프로젝트 루트에서 .venv/bin/python tests/model_integration.py 로 실행."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'model'))
from fastapi.testclient import TestClient
from server import app


class ModelIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_health_and_frontend(self):
        health = self.client.get('/health')
        self.assertEqual(health.status_code, 200)
        self.assertEqual(len(health.json()['models']), 3)
        self.assertIn('id="prediction"', self.client.get('/').text)
        self.assertEqual(self.client.get('/app.js').status_code, 200)

    def test_original_photo(self):
        with (ROOT / 'frontend/asset/shoe3.jpg').open('rb') as photo:
            response = self.client.post('/predict', files={'file': ('shoe3.jpg', photo, 'image/jpeg')})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertIn(result['prediction'], ['정상', 'outsole', 'heel lining', 'outsole + heel lining'])
        self.assertEqual(result['prediction'], result['results'][0]['finding'])
        self.assertEqual(result['threshold'], 0.5)
        print(f"\nReal inference: {result['prediction']} ({result['elapsed_ms']} ms)")

    def test_invalid_file(self):
        for data in [b'', b'not an image']:
            response = self.client.post('/predict', files={'file': ('bad.jpg', data, 'image/jpeg')})
            self.assertEqual(response.status_code, 400)

    def test_local_frontend_cors(self):
        response = self.client.options('/predict', headers={
            'Origin': 'http://localhost:5173',
            'Access-Control-Request-Method': 'POST',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['access-control-allow-origin'], 'http://localhost:5173')


if __name__ == '__main__':
    unittest.main()
