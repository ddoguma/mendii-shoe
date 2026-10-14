const $ = (selector) => document.querySelector(selector);
const views = ['upload', 'confirm', 'loading', 'result'];
let selectedFile = null;
let imageUrl = null;
let analysisTimer;
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
  selectionVersion++;
  selectedFile = null;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  $('#file').value = '';
  $('#preview').removeAttribute('src');
  $('#result-image').removeAttribute('src');
  $('#error').textContent = '';
}
function goHome(event) {
  if (event) event.preventDefault();
  clearTimeout(analysisTimer);
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
async function selectFile(file) {
  if (!file) return;
  const version = ++selectionVersion;
  $('#error').textContent = '';
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
    $('#error').textContent = 'JPG, PNG, WEBP 사진을 선택해 주세요.';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    $('#error').textContent = '사진 크기는 10MB 이하로 올려주세요.';
    return;
  }
  const candidateUrl = URL.createObjectURL(file);
  const candidate = new Image();
  try { candidate.src = candidateUrl; await candidate.decode(); }
  catch {
    URL.revokeObjectURL(candidateUrl);
    if (version === selectionVersion) $('#error').textContent = '사진을 열 수 없어요. 다른 사진을 선택해 주세요.';
    return;
  }
  if (version !== selectionVersion) { URL.revokeObjectURL(candidateUrl); return; }
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  selectedFile = file;
  imageUrl = candidateUrl;
  $('#preview').src = imageUrl;
  $('#file-name').textContent = file.name;
  showView('confirm');
}
$('#file').addEventListener('change', event => selectFile(event.target.files[0]));
$('#replace').addEventListener('click', () => { resetSelection(); showView('upload'); });
$('#dropzone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#file').click(); } });
['dragenter','dragover'].forEach(type => $('#dropzone').addEventListener(type, event => { event.preventDefault(); $('#dropzone').classList.add('dragging'); }));
['dragleave','drop'].forEach(type => $('#dropzone').addEventListener(type, event => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); }));
$('#dropzone').addEventListener('drop', event => selectFile(event.dataTransfer.files[0]));
$('#analyze').addEventListener('click', () => {
  if (!selectedFile || currentView !== 'confirm') return;
  showView('loading');
  analysisTimer = setTimeout(() => {
    $('#result-image').src = imageUrl;
    $('#boxes-toggle').checked = true;
    document.querySelectorAll('.bbox').forEach(box => box.hidden = false);
    showView('result');
  }, 2200);
});
$('#boxes-toggle').addEventListener('change', event => document.querySelectorAll('.bbox').forEach(box => box.hidden = !event.target.checked));
$('#restart').addEventListener('click', () => { resetSelection(); showView('upload'); });
