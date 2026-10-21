const $ = (selector) => document.querySelector(selector);
const views = ['upload', 'confirm', 'loading', 'result'];
let selectedFile = null;
let photos = [];
let imageUrl = null;
let analysisController = null;
const remoteApi = location.hostname.endsWith('.github.io')
  ? window.MENDII_CONFIG?.apiOrigin?.replace(/\/$/, '') : '';
const predictUrl = remoteApi ? `${remoteApi}/predict`
  : ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5173'
    ? `${location.protocol}//${location.hostname}:8000/predict` : '/predict';
let selectionVersion = 0;
let currentView = 'home';
function showView(view) {
  currentView = view;
  $('#home').hidden = view !== 'home';
  $('#workspace').hidden = view === 'home';
  views.forEach(name => $(`#${name}-view`).hidden = name !== view);
  const step = {upload:0, confirm:0, loading:1, result:2}[view];
  document.querySelectorAll('.progress li').forEach((item, index) => {
    item.classList.toggle('active', index === step);
    if (index === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  $('#back').textContent = view === 'confirm' ? '← 사진 다시 선택' : view === 'result' ? '← 새 사진 올리기' : '← 홈으로';
  window.scrollTo({top:0, behavior:'smooth'});
  const heading = view === 'home' ? $('#home h1') : $(`#${view}-view h1`);
  heading.setAttribute('tabindex', '-1');
  heading.focus({preventScroll:true});
}
function resetSelection() {
  if (analysisController) analysisController.abort();
  analysisController = null;
  selectionVersion++;
  selectedFile = null;
  photos.forEach(photo => URL.revokeObjectURL(photo.url));
  photos = [];
  $('#photo-list').replaceChildren();
  $('#result-list').replaceChildren();
  imageUrl = null;
  $('#file').value = '';
  $('#preview').removeAttribute('src');
  $('#result-image').removeAttribute('src');
  $('#error').textContent = '';
  $('#analysis-error').textContent = '';
}
function goHome(event) {
  if (event) event.preventDefault();
  resetSelection();
  showView('home');
}
document.querySelectorAll('[data-start]').forEach(button => button.addEventListener('click', () => showView('upload')));
$('#back').addEventListener('click', () => {
  if (currentView === 'confirm' || currentView === 'result') {
    resetSelection(); showView('upload');
  } else goHome();
});
document.querySelectorAll('.logo').forEach(link => link.addEventListener('click', goHome));
function photoButtons(selector, onSelect) {
  const container = $(selector);
  container.replaceChildren();
  photos.forEach((photo, index) => {
    const button = document.createElement('button');
    button.className = 'text-button';
    button.textContent = `${index + 1}. ${photo.file.name}`;
    button.addEventListener('click', () => onSelect(photo, index));
    container.appendChild(button);
  });
}
function previewPhoto(photo, index) {
  $('#preview').src = photo.url;
  $('#file-name').textContent = `${index + 1}/${photos.length} · ${photo.file.name}`;
}
async function selectFiles(files) {
  if (!files.length) return;
  const version = ++selectionVersion;
  $('#error').textContent = '';
  const candidates = [];
  try {
    for (const file of files) {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
        throw new Error(`${file.name}: JPG, PNG, WEBP 사진을 선택해 주세요.`);
      }
      if (file.size > 10 * 1024 * 1024) {
        throw new Error(`${file.name}: 사진 크기는 10MB 이하로 올려주세요.`);
      }
      const url = URL.createObjectURL(file);
      candidates.push({file, url});
      const candidate = new Image();
      candidate.src = url;
      try { await candidate.decode(); }
      catch { throw new Error(`${file.name}: 사진을 열 수 없어요. 다른 사진을 선택해 주세요.`); }
    }
  } catch (error) {
    candidates.forEach(photo => URL.revokeObjectURL(photo.url));
    if (version === selectionVersion) $('#error').textContent = error.message;
    return;
  }
  if (version !== selectionVersion) {
    candidates.forEach(photo => URL.revokeObjectURL(photo.url));
    return;
  }
  photos.forEach(photo => URL.revokeObjectURL(photo.url));
  photos = candidates;
  selectedFile = photos[0].file;
  imageUrl = photos[0].url;
  previewPhoto(photos[0], 0);
  photoButtons('#photo-list', previewPhoto);
  showView('confirm');
}
$('#file').addEventListener('change', event => selectFiles(Array.from(event.target.files)));
$('#replace').addEventListener('click', () => { resetSelection(); showView('upload'); });
$('#dropzone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#file').click(); } });
['dragenter','dragover'].forEach(type => $('#dropzone').addEventListener(type, event => { event.preventDefault(); $('#dropzone').classList.add('dragging'); }));
['dragleave','drop'].forEach(type => $('#dropzone').addEventListener(type, event => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); }));
$('#dropzone').addEventListener('drop', event => selectFiles(Array.from(event.dataTransfer.files)));
function renderPrediction(data) {
  if (typeof data.prediction !== 'string' || !data.prediction.trim()) {
    throw new Error('분석 결과를 확인할 수 없어요. 다시 시도해 주세요.');
  }
  // 서버 판정은 재계산하지 않고 표시 문구만 한글로 바꿉니다.
  const predictionLabels = {
    '정상': '정상',
    'outsole': '밑창 손상 의심!',
    'heel lining': '뒤꿈치 안감 손상 의심!',
    'outsole + heel lining': '밑창 및 뒤꿈치 안감 손상 의심!',
  };
  $('#prediction').textContent = predictionLabels[data.prediction] || data.prediction;
  $('#prediction').classList.toggle('suspected', ['outsole', 'heel lining', 'outsole + heel lining'].includes(data.prediction));
  const rows = Array.isArray(data.results) ? data.results : [];
  for (const disease of ['outsole', 'heel_lining']) {
    const row = rows.find(item => item.disease === disease);
    const verdict = $(`#${disease}-verdict`);
    verdict.textContent = row?.verdict || '정보 없음';
    verdict.classList.toggle('suspected', row?.verdict?.trim() === '의심');
  }
  $('#result-image').src = imageUrl;
}
$('#analyze').addEventListener('click', async () => {
  if (!selectedFile || currentView !== 'confirm') return;
  const version = selectionVersion;
  const controller = new AbortController();
  analysisController = controller;
  $('#analysis-error').textContent = '';
  // 선택한 File 객체를 그대로 전송해 원본 바이트와 EXIF 정보를 보존합니다.
  showView('loading');
  let timeout;
  let activePhoto;
  try {
    for (const [index, photo] of photos.entries()) {
    activePhoto = photo;
    if (photo.data) continue;
    $('#loading-progress').textContent = `${index + 1}/${photos.length}장 분석 중 · ${photo.file.name}`;
    const form = new FormData();
    form.append('file', photo.file);
    timeout = setTimeout(() => controller.abort(), 120000);
    const response = await fetch(predictUrl, {method: 'POST', body: form, signal: controller.signal,
      ...(remoteApi ? {headers: {'ngrok-skip-browser-warning': 'true'}} : {})});
    if (!response.ok) {
      throw new Error(response.status === 400 || response.status === 422
        ? '이 사진을 분석할 수 없어요. 다른 사진을 선택해 주세요.'
        : '분석 서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
    }
    const data = await response.json();
    if (version !== selectionVersion || analysisController !== controller) return;
    imageUrl = photo.url;
    renderPrediction(data);
    photo.data = data;
    clearTimeout(timeout);
    }
    const showResult = (photo, index) => {
      imageUrl = photo.url;
      renderPrediction(photo.data);
      $('#result-file-name').textContent = `${index + 1}/${photos.length} · ${photo.file.name}`;
    };
    photoButtons('#result-list', showResult);
    showResult(photos[0], 0);
    showView('result');
  } catch (error) {
    if (version !== selectionVersion || analysisController !== controller) return;
    $('#analysis-error').textContent = error.name === 'AbortError'
      ? '분석 시간이 오래 걸리고 있어요. 잠시 후 다시 시도해 주세요.'
      : error instanceof TypeError ? '분석 서버에 연결할 수 없어요. 서버 실행 상태를 확인해 주세요.'
      : error instanceof SyntaxError ? '분석 결과를 읽을 수 없어요. 다시 시도해 주세요.' : error.message;
    if (activePhoto) $('#analysis-error').textContent = `${activePhoto.file.name}: ${$('#analysis-error').textContent}`;
    showView('confirm');
  } finally {
    clearTimeout(timeout);
    if (analysisController === controller) analysisController = null;
  }
});
$('#restart').addEventListener('click', () => { resetSelection(); showView('upload'); });
