/* ============================================================
 * PYP 탐구 단원 설계 도우미 v1.0
 * app.js — 골격 (화면 전환 · 상태 · 저장 · 대화 상자)
 *
 * 이 파일에서 지금 동작하는 것
 *   - 8단계 화면 전환과 진행 레일 갱신
 *   - 하드/소프트 검증 게이트의 연결부 (규칙은 단계 구현 때 등록)
 *   - API 키 저장·삭제, 테마, 임시 저장
 * 아직 비어 있는 것 (다음 작업에서 채움)
 *   - loadData()  : data/*.json 지연 로딩
 *   - callGemini(): 재시도 사다리 · JSON 3겹 방어선
 *   - exportDocx(): 경기도 실습 틀 구조 내보내기
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 상수 ---------- */
  var APP = {
    name: 'PYP 탐구 단원 설계 도우미',
    version: '1.0',
    lastStep: 8
  };

  var KEYS = {
    apiKey: 'pyp.apiKey',
    theme: 'pyp.theme',
    draft: 'pyp.draft',
    vault: 'pyp.vault'
  };

  /* ---------- 설계안 상태 ----------
   * 단계별 산출물을 한 객체에 모은다.
   * 내보내기와 검증 게이트는 모두 이 객체만 읽는다.
   */
  var state = {
    meta: { app: APP.name, version: APP.version, savedAt: null },
    step: 1,
    reached: 1,                 // 지금까지 도달한 최대 단계 (레일 잠금 해제 기준)

    grade: null,                // 1
    subjects: [],
    theme: null,                // 초학문적 주제 id
    standards: [],

    coreIdeaRefs: [],           // 2
    centralIdea: '',
    ercs: {},

    keyConcepts: [],            // 3
    relatedConcepts: [],

    linesOfInquiry: [],         // 4  [{ text, concepts:[] }]

    teacherQuestions: [],       // 5
    studentQuestions: [],

    assessment: {               // 6
      diagnostic: '',
      formative: '',
      summative: '',
      grasps: null,
      criteria: { knowledge: '', understanding: '', skills: '' }
    },

    inquiryModel: null,         // 7  'murdoch' | 'marschall'
    inquiryStages: [],
    atl: [],
    learnerProfile: [],
    actionTypes: [],

    connections: {              // 8
      priorThemes: '',
      otherSubjects: '',
      localGlobal: ''
    }
  };

  /* ---------- 짧은 도우미 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function store(key, value) {
    try {
      if (value === undefined) {
        var raw = localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
      }
      if (value === null) { localStorage.removeItem(key); return null; }
      localStorage.setItem(key, JSON.stringify(value));
      return value;
    } catch (e) {
      console.warn('저장소를 쓸 수 없습니다.', e);
      return null;
    }
  }

  /* ============================================================
   * 검증 게이트
   * 단계 구현 때 registerGuard(n, fn) 으로 규칙을 붙인다.
   * fn 은 { hard: [문자열], soft: [문자열] } 을 돌려준다.
   *   hard = 차단, soft = 확인 후 통과
   * ============================================================ */
  var guards = {};

  function registerGuard(step, fn) { guards[step] = fn; }

  function checkStep(step) {
    var fn = guards[step];
    if (typeof fn !== 'function') return { hard: [], soft: [] };
    var out = fn(state) || {};
    return { hard: out.hard || [], soft: out.soft || [] };
  }

  /* ============================================================
   * 화면 전환
   * ============================================================ */
  function renderStep(opts) {
    $$('.step').forEach(function (sec) {
      var n = Number(sec.dataset.step);
      if (n === state.step) sec.setAttribute('data-active', 'true');
      else sec.removeAttribute('data-active');
    });

    $$('.rail__item').forEach(function (li) {
      var n = Number(li.dataset.step);
      var btn = $('.rail__btn', li);
      if (n === state.step) li.dataset.state = 'current';
      else if (n <= state.reached) li.dataset.state = 'done';
      else li.dataset.state = 'locked';
      btn.disabled = n > state.reached;
      btn.setAttribute('aria-current', n === state.step ? 'step' : 'false');
    });

    // 레일 진행선: 1번 원 중심 ~ 현재 단계 원 중심
    var fill = $('#rail-fill');
    var items = $$('.rail__item');
    if (fill && items.length) {
      var first = items[0].getBoundingClientRect();
      var here = items[state.step - 1].getBoundingClientRect();
      fill.style.height = Math.max(0, (here.top - first.top)) + 'px';
    }

    $('#btn-prev').disabled = state.step === 1;
    $('#btn-next').textContent = state.step === APP.lastStep ? '내보내기' : '다음';
    setStatus('8단계 가운데 ' + state.step + '단계입니다.');

    if (opts && opts.scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setStatus(text, tone) {
    var el = $('#stepnav-status');
    el.textContent = text;
    if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
  }

  function goStep(n) {
    if (n < 1 || n > APP.lastStep) return;
    if (n > state.reached) return;
    state.step = n;
    saveDraft();
    renderStep({ scroll: true });
  }

  function goNext() {
    if (state.step === APP.lastStep) { exportDocx(); return; }

    var result = checkStep(state.step);
    if (result.hard.length) {
      setStatus(result.hard[0], 'stop');
      return;
    }
    if (result.soft.length) {
      askConfirm(result.soft, function () { advance(); });
      return;
    }
    advance();
  }

  function advance() {
    state.step += 1;
    state.reached = Math.max(state.reached, state.step);
    saveDraft();
    renderStep({ scroll: true });
  }

  /* ============================================================
   * 임시 저장
   * ============================================================ */
  function saveDraft() {
    state.meta.savedAt = new Date().toISOString();
    store(KEYS.draft, state);
  }

  function loadDraft() {
    var saved = store(KEYS.draft);
    if (!saved || typeof saved !== 'object') return;
    Object.keys(saved).forEach(function (k) {
      if (k in state) state[k] = saved[k];
    });
    state.reached = Math.min(Math.max(state.reached || 1, 1), APP.lastStep);
    state.step = Math.min(Math.max(state.step || 1, 1), state.reached);
  }

  /* ============================================================
   * 대화 상자
   * ============================================================ */
  function openDialog(id) {
    var dlg = $(id);
    if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
  }
  function closeDialog(id) {
    var dlg = $(id);
    if (dlg && dlg.open) dlg.close();
  }

  var confirmCallback = null;

  function askConfirm(messages, onProceed) {
    var list = $('#confirm-list');
    list.innerHTML = '';
    messages.forEach(function (m) {
      var li = document.createElement('li');
      li.textContent = m;
      list.appendChild(li);
    });
    $('#confirm-desc').textContent = '아래 내용을 의도하신 것이라면 그대로 진행할 수 있습니다.';
    confirmCallback = onProceed;
    openDialog('#dlg-confirm');
  }

  /* ============================================================
   * API 키
   * ============================================================ */
  function getApiKey() { return store(KEYS.apiKey) || ''; }

  function paintKeyState() {
    var has = !!getApiKey();
    $('#key-dot').dataset.state = has ? 'set' : 'unset';
    $('#btn-key').title = has ? 'API 키가 등록되어 있습니다' : 'API 키를 등록해 주세요';
  }

  function keyMessage(text, tone) {
    var el = $('#key-msg');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = 'notice notice--' + (tone || 'info');
  }

  function saveApiKey() {
    var value = $('#key-input').value.trim();
    if (!value) { keyMessage('키를 입력해 주세요.', 'stop'); return; }
    store(KEYS.apiKey, value);
    paintKeyState();
    keyMessage('키를 저장했습니다. 연결 확인은 첫 생성 요청 때 이루어집니다.', 'info');
  }

  function clearApiKey() {
    store(KEYS.apiKey, null);
    $('#key-input').value = '';
    paintKeyState();
    keyMessage('키를 지웠습니다.', 'warn');
  }

  /* ============================================================
   * 보관함 (목록 표시만 — 저장·불러오기는 다음 작업)
   * ============================================================ */
  function renderVault() {
    var items = store(KEYS.vault) || [];
    var list = $('#vault-list');
    var empty = $('#vault-empty');
    list.innerHTML = '';
    empty.hidden = items.length > 0;
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.textContent = (it.title || '제목 없음');
      list.appendChild(li);
    });
  }

  /* ============================================================
   * 아직 비어 있는 계층
   * ============================================================ */

  /** data/*.json 지연 로딩 + 캐시. 다음 작업에서 구현. */
  var dataCache = {};
  function loadData(name) {          // eslint-disable-line no-unused-vars
    if (dataCache[name]) return Promise.resolve(dataCache[name]);
    return fetch('data/' + name + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error(name + '.json 을 불러오지 못했습니다.');
        return r.json();
      })
      .then(function (json) { dataCache[name] = json; return json; });
  }

  /** Gemini 호출. 재시도 사다리와 JSON 방어선은 다음 작업에서 이식. */
  function callGemini(prompt, options) {   // eslint-disable-line no-unused-vars
    return Promise.reject(new Error('생성 기능은 아직 연결되지 않았습니다.'));
  }

  /** 워드 내보내기. 경기도 실습 틀 구조로 다음 작업에서 구현. */
  function exportDocx() {
    setStatus('내보내기는 다음 작업에서 붙입니다.', 'stop');
  }

  /* ============================================================
   * 테마
   * ============================================================ */
  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    $('#theme-icon').textContent = mode === 'dark' ? '☀' : '☾';
    store(KEYS.theme, mode);
  }

  function initTheme() {
    var saved = store(KEYS.theme);
    if (saved !== 'dark' && saved !== 'light') {
      saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(saved);
  }

  /* ============================================================
   * 연결
   * ============================================================ */
  function bind() {
    $('#btn-prev').addEventListener('click', function () { goStep(state.step - 1); });
    $('#btn-next').addEventListener('click', goNext);

    $$('.rail__btn').forEach(function (btn) {
      btn.addEventListener('click', function () { goStep(Number(btn.dataset.goto)); });
    });

    $('#btn-theme').addEventListener('click', function () {
      var now = document.documentElement.getAttribute('data-theme');
      applyTheme(now === 'dark' ? 'light' : 'dark');
    });

    $('#btn-key').addEventListener('click', function () {
      $('#key-input').value = getApiKey();
      keyMessage('');
      openDialog('#dlg-key');
    });
    $('#btn-key-save').addEventListener('click', saveApiKey);
    $('#btn-key-clear').addEventListener('click', clearApiKey);
    $('#btn-key-cancel').addEventListener('click', function () { closeDialog('#dlg-key'); });

    $('#btn-vault').addEventListener('click', function () { renderVault(); openDialog('#dlg-vault'); });
    $('#btn-vault-close').addEventListener('click', function () { closeDialog('#dlg-vault'); });

    $('#btn-confirm-back').addEventListener('click', function () {
      confirmCallback = null;
      closeDialog('#dlg-confirm');
    });
    $('#btn-confirm-go').addEventListener('click', function () {
      var fn = confirmCallback;
      confirmCallback = null;
      closeDialog('#dlg-confirm');
      if (fn) fn();
    });

    window.addEventListener('resize', function () { renderStep(); });
  }

  function init() {
    initTheme();
    loadDraft();
    bind();
    paintKeyState();
    renderStep();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* 다음 작업에서 단계별 모듈이 붙을 자리 */
  window.PYP = {
    state: state,
    goStep: goStep,
    registerGuard: registerGuard,
    loadData: loadData,
    callGemini: callGemini,
    saveDraft: saveDraft
  };
})();
