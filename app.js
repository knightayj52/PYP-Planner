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
    tonghapUnit: null,          // 1~2학년: { unit, area, bigIdea }
    theme: null,                // 초학문적 주제 id
    standards: [],

    coreIdeaRefs: [],           // 2
    centralIdea: '',
    ercs: {},                   // 교사가 확정한 판단
    ercsAi: null,               // AI가 짚어준 의견 (참고용, 교사 판단과 별도로 보관)

    keyConcepts: [],            // 3
    relatedConcepts: [],
    conceptReview: null,        // 교사가 고른 뒤 AI가 짚어준 검토 의견 (참고용)

    linesOfInquiry: [],         // 4  [{ text, concepts:[] }]

    teacherQuestions: [],       // 5
    studentQuestions: [],

    assessment: {               // 6
      diagnostic: '',
      formative: '',
      summative: '',
      frame: null,              // null | 'grasps' | 'rafts'
      frameData: {},            // 고른 틀의 칸 내용
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

  /* 단계별 다시 그리기 함수 등록소.
     앞 단계를 고치고 돌아와도 뒷 단계가 그 결과를 반영하도록 한다. */
  var painters = {};
  function registerPainter(step, fn) { painters[step] = fn; }
  function repaintCurrent() {
    var fn = painters[state.step];
    if (typeof fn === 'function') fn();
  }

  function goStep(n) {
    if (n < 1 || n > APP.lastStep) return;
    if (n > state.reached) return;
    state.step = n;
    saveDraft();
    renderStep({ scroll: true });
    repaintCurrent();
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
    repaintCurrent();
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
    if (value.length < 20) {
      keyMessage('키가 너무 짧습니다. AI Studio에서 복사한 키 전체를 붙여넣어 주세요.', 'stop');
      return;
    }
    var btn = $('#btn-key-save');
    btn.disabled = true;
    keyMessage('키를 확인하는 중입니다…', 'info');

    verifyApiKey(value).then(function (status) {
      btn.disabled = false;
      if (status === 'invalid') {
        keyMessage('키가 받아들여지지 않았습니다. Google AI Studio에서 키를 다시 복사해 주세요.', 'stop');
        return;
      }
      store(KEYS.apiKey, value);
      paintKeyState();
      if (status === 'quota') {
        keyMessage('키를 저장했습니다. 다만 지금은 호출 한도 상태라 잠시 뒤부터 쓸 수 있습니다.', 'warn');
      } else if (status === 'network') {
        keyMessage('키를 저장했습니다. 인터넷 연결이 불안정해 확인은 못 했습니다.', 'warn');
      } else {
        keyMessage('키를 저장했고 연결도 확인했습니다.', 'info');
      }
    })['catch'](function (e) {
      btn.disabled = false;
      keyMessage('확인 중 문제가 생겼습니다. ' + msgOf(e), 'stop');
    });
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

  /* ------------------------------------------------------------
   * Gemini 계층
   *   호출 사다리 : 기본 모델 → (429·503) 5초 뒤 1회 재시도 → 폴백 모델
   *   JSON 방어선 : ① 형식 규칙 자동 첨부 ② 따옴표 무손실 수선
   *                 ③ 절단 복구 → 그래도 안 되면 같은 요청 1회 재시도
   * ------------------------------------------------------------ */
  var GEMINI = {
    model: 'gemini-3.5-flash',
    fallback: 'gemini-3.1-flash-lite',
    version: 'v1beta',
    temperature: 0.7,
    maxTokens: 8192
  };

  // 모든 프롬프트 끝에 붙는다 — JSON 문자열 안 큰따옴표가 깨짐의 주범이라 원천 차단한다.
  var JSON_RULE = '\n[형식 규칙] JSON 문자열 값 안에 큰따옴표(")를 절대 쓰지 마. ' +
                  '인용·대사·강조가 필요하면 작은따옴표나 낫표(『 』)를 사용해.';

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function msgOf(e) { return (e && e.message) ? e.message : String(e || ''); }
  function isQuota(e) { return msgOf(e).indexOf('QUOTA_') === 0; }
  function isOverload(e) { return msgOf(e).indexOf('OVERLOADED') === 0; }
  function isParseFail(e) { return msgOf(e).indexOf('JSON 파싱 실패') === 0; }
  function isDailyBody(b) { return /per\s*day|perday|daily/i.test(String(b || '')); }

  function geminiUrl(model, key) {
    return 'https://generativelanguage.googleapis.com/' + GEMINI.version +
           '/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
  }

  function postGemini(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (body) { return { code: res.status, body: body }; });
    }, function () {
      throw new Error('인터넷 연결이 끊겼거나 Gemini에 닿지 못했습니다. 연결을 확인하고 다시 눌러 주세요.');
    });
  }

  function extractText(data) {
    if (!data || !data.candidates || !data.candidates.length) return '';
    var c = data.candidates[0];
    if (!c.content || !c.content.parts) return '';
    var out = '';
    c.content.parts.forEach(function (p) { if (p.text) out += p.text; });
    return out;
  }

  function callModel(model, prompt, schema) {
    var key = getApiKey();
    if (!key) return Promise.reject(new Error('먼저 오른쪽 위에서 API 키를 등록해 주세요.'));

    var url = geminiUrl(model, key);
    var cfg = {
      responseMimeType: 'application/json',
      temperature: GEMINI.temperature,
      maxOutputTokens: GEMINI.maxTokens
    };
    if (schema) cfg.responseSchema = schema;
    var payload = { contents: [{ parts: [{ text: prompt + JSON_RULE }] }], generationConfig: cfg };

    return postGemini(url, payload).then(function (r) {
      // 순간 몰림(분당 429)·일시 혼잡(503)은 5초 쉬고 한 번만 자동 재시도
      if ((r.code === 429 && !isDailyBody(r.body)) || r.code === 503) {
        return sleep(5000).then(function () { return postGemini(url, payload); });
      }
      return r;
    }).then(function (r) {
      if (r.code === 429) throw new Error((isDailyBody(r.body) ? 'QUOTA_DAILY' : 'QUOTA_MINUTE') + ' (' + model + ')');
      if (r.code === 503) throw new Error('OVERLOADED (' + model + ')');
      if (r.code === 400 || r.code === 403) {
        throw new Error('API 키가 거부되었습니다. 오른쪽 위에서 키를 다시 등록해 주세요.');
      }
      if (r.code !== 200) {
        throw new Error('Gemini 오류 (HTTP ' + r.code + '): ' + String(r.body || '').substring(0, 400));
      }

      var data = JSON.parse(r.body);
      var text = extractText(data);
      if (!text) {
        var why = '';
        if (data.candidates && data.candidates[0] && data.candidates[0].finishReason) {
          why = ' (중단 사유: ' + data.candidates[0].finishReason + ')';
        } else if (data.promptFeedback && data.promptFeedback.blockReason) {
          why = ' (차단 사유: ' + data.promptFeedback.blockReason + ')';
        }
        throw new Error('Gemini가 빈 응답을 보냈습니다' + why + '. 다시 눌러 주세요.');
      }

      try { return parseJson(text); }
      catch (pe) {
        var fixed = repairJson(text);
        if (fixed !== null) return fixed;   // 잘린 꼬리를 정리해 온전한 부분까지 살린다
        throw pe;
      }
    });
  }

  function callLadder(prompt, schema) {
    return callModel(GEMINI.model, prompt, schema)['catch'](function (e) {
      if (!isQuota(e) && !isOverload(e)) throw e;
      return callModel(GEMINI.fallback, prompt, schema)['catch'](function (e2) {
        if (isQuota(e2)) {
          if ((msgOf(e) + ' ' + msgOf(e2)).indexOf('QUOTA_MINUTE') !== -1) {
            throw new Error('요청이 잠깐 몰렸습니다(분당 한도). 1분쯤 뒤에 같은 버튼을 다시 눌러 주세요. 작성한 내용은 저장되어 있습니다.');
          }
          throw new Error('오늘 치 무료 호출 한도를 다 썼습니다. 한국 시간 오후 4시쯤 다시 채워집니다. 작성한 내용은 저장되어 있습니다.');
        }
        if (isOverload(e2)) {
          throw new Error('Gemini 서버가 혼잡합니다. 잠시 뒤 같은 버튼을 다시 눌러 주세요. 작성한 내용은 저장되어 있습니다.');
        }
        throw e2;
      });
    });
  }

  /** 생성 요청 입구. 형식이 어긋나면 같은 요청을 딱 한 번 다시 보낸다. */
  function callGemini(prompt, schema) {
    return callLadder(prompt, schema)['catch'](function (e) {
      if (isParseFail(e)) return callLadder(prompt, schema);
      throw e;
    });
  }

  /* ---- JSON 방어선 ---- */
  function stripFence(t) {
    return String(t).trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  }

  function parseJson(text) {
    var t = stripFence(text);
    try { return JSON.parse(t); }
    catch (e) {
      throw new Error('JSON 파싱 실패: ' + e + '\n원문(앞 400자): ' + t.substring(0, 400));
    }
  }

  /** 문자열 값 안의 이스케이프 안 된 따옴표를 살려 낸다(무손실 수선). */
  function fixQuotes(t) {
    var out = '', inStr = false, esc = false;
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i);
      if (!inStr) { if (c === '"') inStr = true; out += c; continue; }
      if (esc) { esc = false; out += c; continue; }
      if (c === '\\') { esc = true; out += c; continue; }
      if (c === '"') {
        var j = i + 1;
        while (j < t.length && /\s/.test(t.charAt(j))) j++;
        var nx = j < t.length ? t.charAt(j) : '';
        if (nx === ',' || nx === '}' || nx === ']' || nx === ':' || nx === '') { inStr = false; out += c; }
        else { out += '\\"'; }
        continue;
      }
      out += c;
    }
    return out;
  }

  /** 열린 괄호를 세어 닫아 준다. 구조가 어긋나면 null. */
  function closeBrackets(s) {
    var stack = [], inStr = false, esc = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') stack.push(c);
      else if (c === '}') { if (stack.pop() !== '{') return null; }
      else if (c === ']') { if (stack.pop() !== '[') return null; }
    }
    if (inStr) return null;
    var tail = '';
    for (var j = stack.length - 1; j >= 0; j--) tail += (stack[j] === '{' ? '}' : ']');
    return s + tail;
  }

  /** 끝이 잘린 응답에서 온전한 부분까지 살린다. 너무 많이 잃으면 포기하고 재시도에 맡긴다. */
  function repairJson(text) {
    var t = stripFence(text);
    try { return JSON.parse(fixQuotes(t)); } catch (e0) { /* 다음 수단으로 */ }
    var tries = 0;
    for (var cut = t.length; cut > 1 && tries < 400; cut--) {
      var ch = t.charAt(cut - 1);
      if (ch !== '}' && ch !== ']') continue;   // 완결된 경계에서만 자른다
      tries++;
      var closed = closeBrackets(t.substring(0, cut).replace(/,\s*$/, ''));
      if (closed === null) continue;
      try {
        var obj = JSON.parse(closed);
        if (JSON.stringify(obj).length < t.length * 0.6) return null;
        return obj;
      } catch (e) { /* 다음 절단점 */ }
    }
    return null;
  }

  /** 키가 살아 있는지 가볍게 확인한다. 'ok' | 'quota' | 'invalid' */
  function verifyApiKey(key) {
    var url = geminiUrl(GEMINI.fallback, key);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } })
    }).then(function (res) {
      if (res.status === 200) return 'ok';
      if (res.status === 429 || res.status === 503) return 'quota';
      return 'invalid';
    }, function () { return 'network'; });
  }

  /** 워드 내보내기. 경기도 실습 틀 구조로 다음 작업에서 구현. */
  function exportDocx() {
    setStatus('내보내기는 다음 작업에서 붙입니다.', 'stop');
  }

  /* ============================================================
   * 1단계 — 학년 · 단원/교과 · 초학문적 주제 · 성취기준
   *   1~2학년 : 통합교과 단원이 중심, 국어·수학을 더할 수 있음
   *   3~6학년 : 교과 2~4개를 골라 성취기준 풀을 합침
   * ============================================================ */
  var S1 = (function () {
    var fw = null;        // pyp-framework.json
    var pool = null;      // standards-e**.json
    var units = null;     // tonghap.json 의 units

    var TONGHAP_ONLY = ['바른 생활', '슬기로운 생활', '즐거운 생활'];
    var CODE_SUBJECT = { '바': '바른 생활', '슬': '슬기로운 생활', '즐': '즐거운 생활' };
    var AREA_THEME = {
      '01': ['whoWeAre'],
      '02': ['whereWeAre'],
      '03': ['howTheWorldWorks', 'howWeOrganize'],
      '04': ['howWeExpress']
    };
    var SUBJECT_MAX = 4;

    /* ---- 작은 도우미 ---- */
    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function bandFile(g) {
      return g <= 2 ? 'standards-e12' : (g <= 4 ? 'standards-e34' : 'standards-e56');
    }
    function isTonghapName(n) { return TONGHAP_ONLY.indexOf(n) >= 0; }
    function areaNo(a) { return String(a || '').slice(0, 2); }
    function stripCode(t) { return String(t || '').replace(/^\[[^\]]+\]\s*/, ''); }
    function extraSubjects() {
      return (state.subjects || []).filter(function (n) { return !isTonghapName(n); });
    }
    /** 코드 비교용 정규화 — AI가 대괄호를 빼거나 공백을 넣어도 같은 것으로 본다. */
    function normCode(c) {
      return String(c == null ? '' : c).replace(/[\[\]\s·．.]/g, '').toUpperCase();
    }
    function hasStd(code) {
      var k = normCode(code);
      return (state.standards || []).some(function (x) { return normCode(x.code) === k; });
    }
    function addStd(o) { if (!hasStd(o.code)) state.standards.push(o); }
    function dropStd(code) {
      var k = normCode(code);
      state.standards = (state.standards || []).filter(function (x) { return normCode(x.code) !== k; });
    }
    function msg(text, tone) {
      var el = $('#s1-msg');
      if (!el) return;
      if (!text) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = text;
      el.className = 'notice notice--' + (tone || 'info');
    }

    /* ---- 성취기준 정규화 ---- */
    function fromPool(raw) {
      return {
        code: raw.code,
        subject: raw.subject,
        domain: raw.domain,
        text: stripCode(raw.text),
        levels: raw.levels || null,
        from: 'standards'
      };
    }
    function fromUnit(raw, unitName) {
      return {
        code: raw.code,
        subject: CODE_SUBJECT[String(raw.code).charAt(2)] || '통합교과',
        domain: unitName,
        text: stripCode(raw.statement),
        levels: { A: raw.levelA, B: raw.levelB, C: raw.levelC },
        from: 'tonghap'
      };
    }

    /* ---- 데이터 ---- */
    function ensure() {
      var g = state.grade;
      var jobs = [loadData('pyp-framework'), loadData(bandFile(g))];
      if (g <= 2) jobs.push(loadData('tonghap'));
      return Promise.all(jobs).then(function (r) {
        fw = r[0];
        pool = r[1];
        if (g <= 2) units = (r[2] && r[2].units) || [];
        return true;
      });
    }
    function poolSubjects() {
      var seen = {}, out = [];
      ((pool && pool.standards) || []).forEach(function (s) {
        if (isTonghapName(s.subject)) return;
        if (!seen[s.subject]) { seen[s.subject] = 1; out.push(s.subject); }
      });
      return out;
    }
    function subjectStandards(name) {
      return ((pool && pool.standards) || [])
        .filter(function (s) { return s.subject === name; })
        .map(fromPool);
    }
    function unitList(grade) {
      return (units || []).filter(function (u) { return String(u.grade) === String(grade); });
    }
    function findUnit(name) {
      var hit = null;
      (units || []).forEach(function (u) { if (u.unit === name) hit = u; });
      return hit;
    }

    /* ---- 그리기 ---- */
    function paintGrades() {
      var h = '';
      for (var g = 1; g <= 6; g++) {
        h += '<button class="chip" type="button" data-act="grade" data-v="' + g + '"' +
             ' aria-pressed="' + (state.grade === g ? 'true' : 'false') + '">' + g + '학년</button>';
      }
      $('#s1-grades').innerHTML = h;
    }

    function paintScope() {
      var box = $('#s1-scope');
      if (!state.grade) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = state.grade <= 2 ? scopeTonghap() : scopeSubjects();
    }

    function scopeTonghap() {
      var list = unitList(state.grade);
      var byArea = [], seen = {};
      list.forEach(function (u) {
        if (!seen[u.area]) { seen[u.area] = []; byArea.push(u.area); }
        seen[u.area].push(u);
      });

      var h = '<h3 class="block__title"><span class="block__ord">2</span>통합교과 단원 고르기</h3>' +
              '<p class="block__hint">단원 하나가 바른 생활 · 슬기로운 생활 · 즐거운 생활 성취기준을 한 주제로 묶습니다. 단원을 고르면 그 세 가지가 자동으로 담깁니다.</p>';

      byArea.forEach(function (area) {
        h += '<p class="block__sub">' + esc(area) + '</p><div class="cards">';
        seen[area].forEach(function (u) {
          var on = state.tonghapUnit && state.tonghapUnit.unit === u.unit;
          h += '<button class="pick" type="button" data-act="unit" data-v="' + esc(u.unit) + '"' +
               ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
               '<span class="pick__top"><span class="pick__name">' + esc(u.unit) + '</span>' +
               (u.fix === '고정' ? '<span class="tag tag--fix">고정</span>' : '') +
               '</span>' +
               '<span class="pick__meta">' + esc(u.term) + '학기 · ' + esc(u.month) + '월</span>' +
               '<span class="pick__idea">' + esc(String(u.bigIdea).replace(/^[0-9-]+\.\s*/, '')) + '</span>' +
               '</button>';
        });
        h += '</div>';
      });

      var extras = extraSubjects();
      h += '<p class="block__sub">교과 더하기 (고르지 않아도 됩니다)</p>' +
           '<p class="block__hint" style="margin-left:0">단원과 함께 운영할 교과가 있으면 고르세요. 그 교과의 성취기준 목록이 아래에 함께 나타납니다.</p>' +
           '<div class="chips">';
      poolSubjects().forEach(function (name) {
        h += '<button class="chip" type="button" data-act="subject" data-v="' + esc(name) + '"' +
             ' aria-pressed="' + (extras.indexOf(name) >= 0 ? 'true' : 'false') + '">' + esc(name) + '</button>';
      });
      h += '</div>';
      return h;
    }

    function scopeSubjects() {
      var picked = state.subjects || [];
      var h = '<h3 class="block__title"><span class="block__ord">2</span>교과 고르기</h3>' +
              '<p class="block__hint">초학문적 탐구이므로 교과를 2개에서 4개까지 함께 고릅니다. 지금 ' +
              picked.length + '개를 골랐습니다.</p><div class="chips">';
      poolSubjects().forEach(function (name) {
        h += '<button class="chip" type="button" data-act="subject" data-v="' + esc(name) + '"' +
             ' aria-pressed="' + (picked.indexOf(name) >= 0 ? 'true' : 'false') + '">' + esc(name) + '</button>';
      });
      return h + '</div>';
    }

    function paintThemes() {
      var box = $('#s1-theme');
      var ready = state.grade && (state.grade <= 2 ? !!state.tonghapUnit : (state.subjects || []).length > 0);
      if (!ready || !fw) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;

      var rec = [];
      if (state.grade <= 2 && state.tonghapUnit) {
        rec = AREA_THEME[areaNo(state.tonghapUnit.area)] || [];
      }
      var h = '<h3 class="block__title"><span class="block__ord">3</span>초학문적 주제 고르기</h3>' +
              '<p class="block__hint">' +
              (rec.length
                ? '고르신 단원과 결이 가까운 주제에 추천 표시를 붙였습니다. 다른 주제를 고르셔도 됩니다.'
                : '이 단원이 어떤 큰 물음 아래 놓이는지 정합니다.') +
              '</p><div class="cards">';

      (fw.transdisciplinaryThemes || []).forEach(function (t) {
        var on = state.theme === t.id;
        h += '<button class="pick" type="button" data-act="theme" data-v="' + esc(t.id) + '"' +
             ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
             '<span class="pick__top"><span class="pick__name">' + esc(t.ko) + '</span>' +
             (rec.indexOf(t.id) >= 0 ? '<span class="tag tag--rec">추천</span>' : '') +
             '</span><span class="pick__meta">' + esc(t.en) + '</span><ul class="pick__list">';
        (t.descriptors || []).forEach(function (d) { h += '<li>' + esc(d) + '</li>'; });
        return h += '</ul></button>';
      });
      box.innerHTML = h + '</div>';
    }

    function stdRow(o) {
      return '<label class="std">' +
             '<input type="checkbox" data-code="' + esc(o.code) + '"' + (hasStd(o.code) ? ' checked' : '') + '>' +
             '<span class="std__code">' + esc(o.code) + '</span>' +
             '<span class="std__text">' + esc(o.text) + '</span></label>';
    }

    function stdGroup(title, list, openIt) {
      var byDom = [], seen = {};
      list.forEach(function (o) {
        if (!seen[o.domain]) { seen[o.domain] = []; byDom.push(o.domain); }
        seen[o.domain].push(o);
      });
      var picked = list.filter(function (o) { return hasStd(o.code); }).length;
      var h = '<details class="group" data-key="' + esc(title) + '"' + (openIt ? ' open' : '') +
              '><summary>' + esc(title) +
              '<span class="group__count">' + picked + ' / ' + list.length + '</span></summary>';
      byDom.forEach(function (d) {
        if (byDom.length > 1 || d !== title) h += '<p class="group__dom">' + esc(d) + '</p>';
        seen[d].forEach(function (o) { h += stdRow(o); });
      });
      return h + '</details>';
    }

    var openKeys = null;   // 다시 그려도 펼친 교과가 접히지 않게 기억해 둔다

    function rememberOpen() {
      var box = $('#s1-std');
      if (!box || box.hidden) return;
      var found = [];
      $$('.group[open]', box).forEach(function (d) {
        var k = d.getAttribute('data-key');
        if (k) found.push(k);
      });
      openKeys = found;
    }

    function paintStd() {
      var box = $('#s1-std');
      var ready = state.grade && (state.grade <= 2 ? !!state.tonghapUnit : (state.subjects || []).length > 0);
      if (!ready) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;

      var n = (state.standards || []).length;
      var h = '<h3 class="block__title"><span class="block__ord">4</span>성취기준 고르기</h3>' +
              '<p class="block__hint">이 단원에서 실제로 다룰 성취기준만 남겨 주세요. 나중 단계에서 중심 아이디어와 평가의 근거가 됩니다.</p>' +
              '<div class="rowbtns">' +
              '<button class="btn" type="button" data-act="ai">주제에 맞는 성취기준 추천받기</button>' +
              '<span class="count">고른 성취기준 <strong>' + n + '</strong>개</span></div>' +
              '<p class="notice notice--info" id="s1-msg" hidden></p>';

      if (state.grade <= 2 && state.tonghapUnit) {
        var u = findUnit(state.tonghapUnit.unit);
        if (u) {
          h += stdGroup('통합교과 · ' + u.unit,
                        (u.standards || []).map(function (r) { return fromUnit(r, u.unit); }), true);
        }
      }
      var subs = state.grade <= 2 ? extraSubjects() : (state.subjects || []);
      subs.forEach(function (name) {
        var list = subjectStandards(name);
        if (list.length) h += stdGroup(name, list, subs.length <= 2);
      });

      box.innerHTML = h;
      if (openKeys) {
        $$('.group', box).forEach(function (d) {
          d.open = openKeys.indexOf(d.getAttribute('data-key')) >= 0;
        });
      }
    }

    function paintAll() {
      rememberOpen();
      paintGrades(); paintScope(); paintThemes(); paintStd();
      saveDraft();
    }

    /* ---- 조작 ---- */
    function pickGrade(g) {
      if (state.grade === g) return;
      state.grade = g;
      state.subjects = [];
      state.tonghapUnit = null;
      state.theme = null;
      state.standards = [];
      setStatus('성취기준을 불러오는 중입니다…');
      ensure().then(function () {
        setStatus('8단계 가운데 1단계입니다.');
        paintAll();
      })['catch'](function (e) {
        setStatus('데이터를 불러오지 못했습니다. ' + e.message, 'stop');
      });
    }

    function pickUnit(name) {
      var u = findUnit(name);
      if (!u) return;
      // 단원을 바꾸면 이전 단원의 성취기준만 걷어내고 새 단원 것으로 채운다.
      state.standards = (state.standards || []).filter(function (x) { return x.from !== 'tonghap'; });
      state.tonghapUnit = { unit: u.unit, area: u.area, bigIdea: u.bigIdea };
      (u.standards || []).forEach(function (r) { addStd(fromUnit(r, u.unit)); });
      var keep = extraSubjects();
      state.subjects = TONGHAP_ONLY.concat(keep);
      openKeys = null;
      paintAll();
    }

    function pickSubject(name) {
      var list = (state.subjects || []).slice();
      var at = list.indexOf(name);
      if (at >= 0) {
        list.splice(at, 1);
        state.standards = (state.standards || []).filter(function (x) { return x.subject !== name; });
      } else {
        if (state.grade > 2 && list.length >= SUBJECT_MAX) {
          setStatus('교과는 ' + SUBJECT_MAX + '개까지 고를 수 있습니다. 하나를 빼고 다시 골라 주세요.', 'stop');
          return;
        }
        list.push(name);
      }
      state.subjects = list;
      openKeys = null;
      setStatus('8단계 가운데 1단계입니다.');
      paintAll();
    }

    function pickTheme(id) {
      state.theme = (state.theme === id) ? null : id;
      paintAll();
    }

    function updateCounts() {
      var box = $('#s1-std');
      if (!box || box.hidden) return;
      var total = $('.count strong', box);
      if (total) total.textContent = (state.standards || []).length;
      $$('.group', box).forEach(function (d) {
        var all = $$('input[data-code]', d);
        var on = all.filter(function (i) { return i.checked; }).length;
        var lbl = $('.group__count', d);
        if (lbl) lbl.textContent = on + ' / ' + all.length;
      });
      saveDraft();
    }

    function toggleStd(code, on) {
      if (!on) { dropStd(code); updateCounts(); return; }
      var k = normCode(code);
      var found = null;
      if (state.grade <= 2 && state.tonghapUnit) {
        var u = findUnit(state.tonghapUnit.unit);
        (u && u.standards || []).forEach(function (r) {
          if (normCode(r.code) === k) found = fromUnit(r, u.unit);
        });
      }
      if (!found) {
        ((pool && pool.standards) || []).forEach(function (r) {
          if (normCode(r.code) === k) found = fromPool(r);
        });
      }
      if (found) addStd(found);
      updateCounts();
    }

    function themeName(id) {
      var hit = null;
      ((fw && fw.transdisciplinaryThemes) || []).forEach(function (t) { if (t.id === id) hit = t; });
      return hit;
    }

    /** 후보를 뽑을 성취기준 풀 — 통합교과 단원 것은 이미 담겨 있으므로 추가 교과 위주로 본다. */
    function candidatePool() {
      var subs = state.grade <= 2 ? extraSubjects() : (state.subjects || []);
      var out = [];
      subs.forEach(function (name) {
        subjectStandards(name).forEach(function (o) { out.push(o); });
      });
      return out;
    }

    function buildPrompt() {
      var t = themeName(state.theme) || {};
      var lines = candidatePool().map(function (o) {
        return '- ' + o.code + ' [' + o.subject + '·' + o.domain + '] ' + o.text;
      });
      var already = (state.standards || []).map(function (o) {
        return '- ' + o.code + ' ' + o.text;
      });

      var p = '당신은 IB PYP 초학문적 탐구 단원을 설계하는 한국 초등학교 교사를 돕는다.\n\n' +
              '[학년] ' + state.grade + '학년\n' +
              '[초학문적 주제] ' + (t.ko || '') + ' (' + (t.en || '') + ')\n' +
              '[주제 설명]\n' + ((t.descriptors || []).map(function (d) { return '- ' + d; }).join('\n')) + '\n\n';

      if (state.grade <= 2 && state.tonghapUnit) {
        p += '[통합교과 단원] ' + state.tonghapUnit.unit + ' — ' +
             String(state.tonghapUnit.bigIdea).replace(/^[0-9-]+\.\s*/, '') + '\n\n';
      }
      if (already.length) {
        p += '[이미 고른 성취기준]\n' + already.join('\n') + '\n\n';
      }
      p += '[고를 수 있는 성취기준 목록]\n' + lines.join('\n') + '\n\n' +
           '[할 일]\n' +
           '위 목록에서 이 초학문적 주제의 탐구에 실제로 기여하는 성취기준을 4개에서 6개 고른다.\n' +
           '- 반드시 목록에 있는 코드만 쓴다. 목록에 없는 코드를 지어내지 않는다.\n' +
           '- 이미 고른 성취기준과 겹치지 않게 한다.\n' +
           '- 교과가 한쪽으로 쏠리지 않게 두 교과 이상에서 고른다.\n' +
           '- 이유는 한 문장으로, 이 주제의 탐구와 어떻게 이어지는지 쓴다.\n\n' +
           '[출력] 다음 형태의 JSON만 출력한다.\n' +
           '{ "picks": [ { "code": "[4사01-01]", "why": "고른 이유 한 문장" } ] }\n' +
           'code는 위 목록에 적힌 그대로, 대괄호까지 포함해 옮겨 적는다.';
      return p;
    }

    function applyPicks(picks) {
      var pooled = candidatePool();
      var index = {};
      pooled.forEach(function (o) { index[normCode(o.code)] = o; });

      var added = 0, unknown = 0, dup = 0, missed = [];
      (picks || []).forEach(function (p) {
        var raw = String((p && p.code) || '').trim();
        var hit = index[normCode(raw)];
        if (!hit) { unknown++; if (missed.length < 3) missed.push(raw); return; }
        if (hasStd(hit.code)) { dup++; return; }
        hit.why = String((p && p.why) || '');
        addStd(hit);
        added++;
      });
      return { added: added, unknown: unknown, dup: dup, missed: missed, asked: (picks || []).length };
    }

    function askAi() {
      if (!state.theme) { msg('먼저 초학문적 주제를 골라 주세요.', 'warn'); return; }
      if (!candidatePool().length) {
        msg(state.grade <= 2
          ? '추천할 목록이 없습니다. 위에서 국어나 수학을 더해 주세요.'
          : '추천할 목록이 없습니다. 교과를 먼저 골라 주세요.', 'warn');
        return;
      }
      var btn = $('#s1-std [data-act="ai"]');
      if (btn) { btn.disabled = true; btn.textContent = '추천을 받는 중…'; }
      msg('주제와 성취기준을 견주어 보는 중입니다. 10초쯤 걸립니다.', 'info');

      callGemini(buildPrompt()).then(function (res) {
        var r = applyPicks(res && res.picks);
        paintAll();
        if (r.added > 0) {
          msg('성취기준 ' + r.added + '개를 담았습니다. 목록에서 확인하고 필요 없는 것은 체크를 풀어 주세요.' +
              (r.unknown ? ' (목록에 없는 코드 ' + r.unknown + '개는 건너뛰었습니다.)' : ''), 'info');
        } else if (r.dup > 0) {
          msg('추천받은 ' + r.dup + '개가 이미 골라 둔 것과 같습니다. 다른 성취기준이 필요하면 목록에서 직접 골라 주세요.', 'warn');
        } else if (r.unknown > 0) {
          msg('추천받은 코드를 목록에서 찾지 못했습니다(' + r.missed.join(', ') + '). 다시 한 번 눌러 주시고, 계속 같으면 알려 주세요.', 'stop');
        } else {
          msg('추천이 비어 있습니다. 다시 한 번 눌러 주세요.', 'warn');
        }
      })['catch'](function (e) {
        paintAll();
        msg(msgOf(e), 'stop');
      });
    }

    /* ---- 연결 ---- */
    function bindStep1() {
      var root = $('#step-1');
      root.addEventListener('click', function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el || !root.contains(el)) return;
        var v = el.getAttribute('data-v');
        switch (el.getAttribute('data-act')) {
          case 'grade': pickGrade(Number(v)); break;
          case 'unit': pickUnit(v); break;
          case 'subject': pickSubject(v); break;
          case 'theme': pickTheme(v); break;
          case 'ai': askAi(); break;
        }
      });
      root.addEventListener('change', function (ev) {
        var t = ev.target;
        if (t && t.matches && t.matches('input[data-code]')) {
          toggleStd(t.getAttribute('data-code'), t.checked);
        }
      });
    }

    /* ---- 검증 ---- */
    registerGuard(1, function (st) {
      var hard = [], soft = [];
      if (!st.grade) hard.push('학년을 먼저 골라 주세요.');
      else if (st.grade <= 2 && !st.tonghapUnit) hard.push('통합교과 단원을 골라 주세요.');
      else if (st.grade > 2) {
        var n = (st.subjects || []).length;
        if (n < 2) hard.push('초학문적 탐구이므로 교과를 2개 이상 골라 주세요.');
        else if (n > 4) hard.push('교과는 4개까지만 고를 수 있습니다.');
      }
      if (!st.theme) hard.push('초학문적 주제를 골라 주세요.');
      if (!(st.standards || []).length) hard.push('성취기준을 하나 이상 골라 주세요.');

      if (hard.length === 0 && (st.standards || []).length < 3) {
        soft.push('성취기준이 ' + st.standards.length + '개입니다. 3~4주 단원이라면 조금 적을 수 있습니다.');
      }
      return { hard: hard, soft: soft };
    });

    function init() {
      paintGrades();
      bindStep1();
      if (state.grade) {
        ensure().then(paintAll)['catch'](function () { /* 데이터 없으면 학년 화면만 */ });
      }
    }

    return { init: init, repaint: paintAll };
  })();

  /* ============================================================
   * 2단계 — 중심 아이디어
   *   ① 핵심 아이디어 원문 앵커링(호출 없음)
   *   ② 후보 3개 + AI의 ERCS 의견
   *   ③ 교사가 고르고 고쳐 쓰기
   *   ④ 교사가 최종 판단 (AI 의견은 참고로만 곁들임)
   * ============================================================ */
  var S2 = (function () {
    var fw = null, core = null, cands = [];
    var hadIdea = false;   // 편집칸이 비었다가 채워지는 순간을 잡아 점검 항목을 띄운다

    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function msg(text, tone) {
      var el = $('#s2-msg');
      if (!el) return;
      if (!text) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = text;
      el.className = 'notice notice--' + (tone || 'info');
    }
    function ercsItems() {
      return (fw && fw.qualityCriteria && fw.qualityCriteria.centralIdea &&
              fw.qualityCriteria.centralIdea.items) || [];
    }
    function themeOf(id) {
      var hit = null;
      ((fw && fw.transdisciplinaryThemes) || []).forEach(function (t) { if (t.id === id) hit = t; });
      return hit;
    }

    /** 고른 성취기준의 (교과·영역)에 걸리는 핵심 아이디어를 모은다. 호출 없음. */
    function anchors() {
      var want = {}, out = [];
      (state.standards || []).forEach(function (o) {
        if (o.from === 'tonghap') return;      // 통합교과는 핵심 아이디어 체계가 다르다
        want[o.subject + '|' + o.domain] = true;
      });
      ((core && core.entries) || []).forEach(function (e) {
        if (!want[e.subject + '|' + e.domain]) return;
        (e.ideas || []).forEach(function (idea) {
          out.push({ subject: e.subject, domain: e.domain, id: idea.id, text: idea.text });
        });
      });
      return out;
    }

    function ensure() {
      return Promise.all([loadData('pyp-framework'), loadData('core-ideas')])
        .then(function (r) { fw = r[0]; core = r[1]; return true; });
    }

    /* ---- 그리기 ---- */
    function paintAnchor() {
      var list = anchors();
      state.coreIdeaRefs = list.map(function (a) { return a.id; });

      var h = '<h3 class="block__title"><span class="block__ord">1</span>핵심 아이디어 살펴보기</h3>';
      if (!list.length) {
        h += '<p class="block__hint">고르신 성취기준에 맞물리는 핵심 아이디어를 찾지 못했습니다. ' +
             '아래에서 바로 중심 아이디어 후보를 받아 보세요.</p>';
        $('#s2-anchor').innerHTML = h;
        return;
      }
      h += '<p class="block__hint">2022 개정 교육과정이 이 영역에서 무엇을 큰 줄기로 삼는지 먼저 봅니다. ' +
           '중심 아이디어를 지을 때 이 문장들이 근거가 됩니다.</p>';

      var byDom = [], seen = {};
      list.forEach(function (a) {
        var k = a.subject + ' · ' + a.domain;
        if (!seen[k]) { seen[k] = []; byDom.push(k); }
        seen[k].push(a);
      });
      byDom.forEach(function (k) {
        h += '<div class="anchor"><p class="anchor__src">' + esc(k) + '</p>';
        seen[k].forEach(function (a) { h += '<p class="anchor__text">' + esc(a.text) + '</p>'; });
        h += '</div>';
      });
      $('#s2-anchor').innerHTML = h;
    }

    function paintCand() {
      var h = '<h3 class="block__title"><span class="block__ord">2</span>중심 아이디어 후보 받기</h3>' +
              '<p class="block__hint">핵심 아이디어와 고르신 성취기준, 초학문적 주제를 함께 놓고 후보 세 개를 만듭니다. ' +
              '고른 뒤 아래에서 얼마든지 고쳐 쓸 수 있습니다.</p>' +
              '<div class="rowbtns">' +
              '<button class="btn btn--primary" type="button" data-act="gen">' +
              (cands.length ? '다시 받기' : '후보 세 개 받기') + '</button></div>' +
              '<p class="notice notice--info" id="s2-msg" hidden></p>';

      cands.forEach(function (c, i) {
        var on = state.centralIdea && state.centralIdea === c.text;
        h += '<button class="cand" type="button" data-act="pick" data-i="' + i + '"' +
             ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
             '<span class="cand__text">' + esc(c.text) + '</span>';
        if (c.note) h += '<span class="cand__note">' + esc(c.note) + '</span>';
        // 아래 ercs 딱지는 별도 줄로 이어진다
        if (c.ercs) {
          h += '<span class="ercs">';
          ercsItems().forEach(function (it) {
            var v = c.ercs[it.id];
            h += '<span class="ercs__item" data-v="' + (v === false ? 'weak' : (v === true ? 'yes' : '')) + '">' +
                 esc(it.ko) + (v === false ? ' 약함' : (v === true ? '' : ' ?')) + '</span>';
          });
          h += '</span>';
        }
        h += '</button>';
      });
      $('#s2-cand').innerHTML = h;
    }

    function formChecks(t) {
      var v = String(t || '').trim();
      return {
        one: v.length > 0 && !/[.!?。]\s*\S/.test(v),
        // 한국어 과거형은 '았다·었다·였다'로 끝난다. 미래·추측형도 함께 걸러 낸다.
        present: !/((았|었|였)다|할 것이다|일 것이다|겠다)\s*[.。]?\s*$/.test(v),
        noProper: !/[A-Z][a-zA-Z]{2,}/.test(v),
        // 게시물·문서에 그대로 실리므로 존댓말 어미는 걸러 낸다.
        plain: !/(습니다|입니다|됩니다|합니다|칩니다|갑니다|니다)\s*[.。]?\s*$/.test(v)
      };
    }

    function paintEdit() {
      var t = state.centralIdea || '';
      var f = formChecks(t);
      var h = '<h3 class="block__title"><span class="block__ord">3</span>중심 아이디어 다듬기</h3>' +
              '<p class="block__hint">우리 반 아이들의 말로 고쳐 주세요. 한 문장, 현재 시제, 고유명사 없이 씁니다.</p>' +
              '<textarea class="editor" id="s2-text" placeholder="예: 사람들은 가진 것이 한정되어 있어 무엇을 먼저 할지 선택한다.">' +
              esc(t) + '</textarea>' +
              '<div class="formcheck">' +
              '<span data-ok="' + (t ? f.one : '') + '">한 문장</span>' +
              '<span data-ok="' + (t ? f.present : '') + '">현재 시제</span>' +
              '<span data-ok="' + (t ? f.noProper : '') + '">고유명사 없음</span>' +
              '<span data-ok="' + (t ? f.plain : '') + '">평서형(-다)</span>' +
              '</div>';
      $('#s2-edit').innerHTML = h;
    }

    function paintErcs() {
      var box = $('#s2-ercs');
      if (!state.centralIdea) { box.innerHTML = ''; return; }
      var ai = state.ercsAi || {};
      var h = '<h3 class="block__title"><span class="block__ord">4</span>네 가지로 따져보기</h3>' +
              '<p class="block__hint">아래는 AI가 짚어본 것이지 판정이 아닙니다. ' +
              '우리 반 아이들을 아는 사람은 선생님이므로, 읽어 보고 다르다 싶으면 그대로 체크하거나 풀어 주세요.</p>';

      ercsItems().forEach(function (it) {
        var mine = state.ercs && state.ercs[it.id];
        var note = ai[it.id];
        h += '<label class="check">' +
             '<input type="checkbox" data-ercs="' + esc(it.id) + '"' + (mine ? ' checked' : '') + '>' +
             '<span><span class="check__name">' + esc(it.ko) + '</span> ' +
             '<span class="check__q">' + esc(it.check) + '</span>';
        if (note) h += '<span class="check__ai">AI 의견 — ' + esc(note) + '</span>';
        h += '</span></label>';
      });
      box.innerHTML = h;
    }

    function paintAll() {
      if (!fw || !core) return;
      hadIdea = !!String(state.centralIdea || '').trim();
      paintAnchor(); paintCand(); paintEdit(); paintErcs();
      saveDraft();
    }

    /* ---- 생성 ---- */
    function buildPrompt() {
      var t = themeOf(state.theme) || {};
      var stds = (state.standards || []).map(function (o) {
        return '- ' + o.code + ' [' + o.subject + '] ' + o.text;
      }).join('\n');
      var anch = anchors().map(function (a) {
        return '- [' + a.subject + '·' + a.domain + '] ' + a.text;
      }).join('\n');

      var p = '당신은 IB PYP 초학문적 탐구 단원을 설계하는 한국 초등학교 교사를 돕는다.\n\n' +
              '[학년] ' + state.grade + '학년\n' +
              '[초학문적 주제] ' + (t.ko || '') + '\n' +
              '[주제 설명]\n' + ((t.descriptors || []).map(function (d) { return '- ' + d; }).join('\n')) + '\n\n';

      if (state.grade <= 2 && state.tonghapUnit) {
        p += '[통합교과 단원] ' + state.tonghapUnit.unit + ' — ' +
             String(state.tonghapUnit.bigIdea).replace(/^[0-9-]+\.\s*/, '') + '\n\n';
      }
      if (anch) p += '[2022 개정 교육과정 핵심 아이디어 — 근거로 삼을 것]\n' + anch + '\n\n';
      p += '[고른 성취기준]\n' + stds + '\n\n' +
           '[할 일] 이 단원의 중심 아이디어(central idea) 후보를 서로 다른 관점으로 3개 만든다.\n' +
           '중심 아이디어의 조건:\n' +
           '- 개념과 개념의 관계를 담은 한 문장으로 쓴다.\n' +
           '- 현재 시제로 쓴다. 고유명사와 특정 지명·인명을 넣지 않는다.\n' +
           '- 평서형 종결어미로 끝낸다(-다). 존댓말 어미(-습니다, -됩니다, -합니다)를 쓰지 않는다.\n' +
           '- ' + state.grade + '학년 학생이 읽고 뜻을 짐작할 수 있는 낱말로 쓴다.\n' +
           '- 사실 하나를 말하는 문장이 아니라, 여러 사례에 걸쳐 통하는 문장으로 쓴다.\n' +
           '- 세 후보는 서로 다른 개념 축을 잡는다. 표현만 바꾼 문장을 내지 않는다.\n\n' +
           '각 후보마다 다음 네 가지를 스스로 따져 true/false로 답한다. 확신이 없으면 false로 둔다.\n' +
           '- engaging: 이 학년 학생 다수에게 흥미로운가\n' +
           '- relevant: 학생이 이전에 배우거나 겪은 것과 이어지는가\n' +
           '- challenging: 지금 아는 것보다 한 걸음 나아가게 하는가\n' +
           '- significant: 이 초학문적 주제를 깊이 이해하는 데 핵심인가\n' +
           'false로 둔 항목이 있으면 comment에 무엇이 아쉬운지 한 문장으로 적는다.\n\n' +
           '[출력] 다음 형태의 JSON만 출력한다.\n' +
           '{ "candidates": [ { "text": "사람들은 가진 것이 한정되어 있어 무엇을 먼저 할지 선택한다.", ' +
           '"note": "어떤 개념 축을 잡았는지 한 문장", ' +
           '"ercs": { "engaging": true, "relevant": true, "challenging": false, "significant": true }, ' +
           '"comment": { "challenging": "아쉬운 점 한 문장" } } ] }';
      return p;
    }

    function generate() {
      if (!(state.standards || []).length) { msg('1단계에서 성취기준을 먼저 골라 주세요.', 'warn'); return; }
      var btn = $('#s2-cand [data-act="gen"]');
      if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }
      msg('핵심 아이디어와 성취기준을 견주어 문장을 짓는 중입니다. 15초쯤 걸립니다.', 'info');

      callGemini(buildPrompt()).then(function (res) {
        var got = (res && res.candidates) || [];
        cands = got.filter(function (c) { return c && c.text; }).slice(0, 3).map(function (c) {
          return {
            text: String(c.text).trim(),
            note: c.note || '',
            ercs: c.ercs || null,
            comment: c.comment || {}
          };
        });
        paintAll();
        msg(cands.length ? '후보 ' + cands.length + '개를 만들었습니다. 마음에 드는 것을 누르고 아래에서 고쳐 쓰세요.'
                         : '후보를 만들지 못했습니다. 다시 눌러 주세요.', cands.length ? 'info' : 'warn');
      })['catch'](function (e) {
        paintAll();
        msg(msgOf(e), 'stop');
      });
    }

    /* ---- 조작 ---- */
    function pick(i) {
      var c = cands[i];
      if (!c) return;
      state.centralIdea = c.text;
      state.ercsAi = {};
      state.ercs = {};
      ercsItems().forEach(function (it) {
        var v = c.ercs && c.ercs[it.id];
        // AI가 괜찮다고 본 항목만 미리 체크해 둔다. 교사가 언제든 뒤집을 수 있다.
        state.ercs[it.id] = (v === true);
        if (v === false) {
          state.ercsAi[it.id] = (c.comment && c.comment[it.id]) || '이 항목이 아쉬울 수 있습니다.';
        }
      });
      paintAll();
    }

    function bindStep2() {
      var root = $('#step-2');
      root.addEventListener('click', function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el || !root.contains(el)) return;
        if (el.getAttribute('data-act') === 'gen') generate();
        if (el.getAttribute('data-act') === 'pick') pick(Number(el.getAttribute('data-i')));
      });
      root.addEventListener('change', function (ev) {
        var t = ev.target;
        if (t && t.matches && t.matches('input[data-ercs]')) {
          state.ercs = state.ercs || {};
          state.ercs[t.getAttribute('data-ercs')] = t.checked;
          saveDraft();
        }
      });
      root.addEventListener('input', function (ev) {
        if (ev.target && ev.target.id === 's2-text') {
          state.centralIdea = ev.target.value;
          var f = formChecks(state.centralIdea);
          var tags = $$('#s2-edit .formcheck span');
          if (tags.length === 4 && state.centralIdea.trim()) {
            tags[0].setAttribute('data-ok', String(f.one));
            tags[1].setAttribute('data-ok', String(f.present));
            tags[2].setAttribute('data-ok', String(f.noProper));
            tags[3].setAttribute('data-ok', String(f.plain));
          }
          // 후보를 고르지 않고 직접 써 넣은 경우에도 네 가지 점검이 뜨도록 한다
          var has = !!state.centralIdea.trim();
          if (has !== hadIdea) { hadIdea = has; paintErcs(); }
          saveDraft();
        }
      });
    }

    registerGuard(2, function (st) {
      var hard = [], soft = [];
      var t = String(st.centralIdea || '').trim();
      if (!t) hard.push('중심 아이디어를 한 문장 써 주세요.');
      else {
        var f = formChecks(t);
        if (!f.one) hard.push('중심 아이디어는 한 문장으로 씁니다. 문장을 하나로 줄여 주세요.');
        if (!f.present) hard.push('중심 아이디어는 현재 시제로 씁니다.');
        if (!f.noProper) hard.push('중심 아이디어에는 고유명사를 넣지 않습니다.');
      }
      if (!hard.length) {
        if (!formChecks(t).plain) {
          soft.push('중심 아이디어가 존댓말로 끝납니다. 보통은 평서형(-다)으로 씁니다.');
        }
        var off = [];
        ercsItems().forEach(function (it) { if (!(st.ercs && st.ercs[it.id])) off.push(it.ko); });
        if (off.length) soft.push('네 가지 가운데 ' + off.join(' · ') + ' 항목에 체크가 없습니다.');
      }
      return { hard: hard, soft: soft };
    });

    function init() {
      bindStep2();
      ensure().then(paintAll)['catch'](function () { /* 데이터가 없으면 조용히 넘어간다 */ });
    }

    return { init: init, repaint: paintAll };
  })();

  /* ============================================================
   * 3단계 — 개념
   *   ① 주요 개념 최대 3개 : 교사가 먼저 고른다. AI는 끼어들지 않는다.
   *   ② 관련 개념          : 교과 × 개념 교집합에서 호출 없이 후보가 나온다.
   *   ③ 검토 의견          : 교사가 고른 뒤에야 AI가 짚어준다(관련 개념 제안과 같은 호출).
   * ============================================================ */
  var S3 = (function () {
    var fw = null, rel = null;
    var KEY_MAX = 3;
    var suggested = [];   // AI가 새로 제안한 관련 개념

    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function msg(text, tone) {
      var el = $('#s3-msg');
      if (!el) return;
      if (!text) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = text;
      el.className = 'notice notice--' + (tone || 'info');
    }
    function keyConceptList() { return (fw && fw.keyConcepts) || []; }
    function koOf(id) {
      var hit = '';
      keyConceptList().forEach(function (k) { if (k.id === id) hit = k.ko; });
      return hit || id;
    }
    function subjectsForConcepts() {
      // 1~2학년은 바·슬·즐을 통합교과 하나로 본다(데이터가 그렇게 묶여 있다).
      var subs = (state.subjects || []).slice();
      var out = [], seen = {};
      subs.forEach(function (n) {
        var name = (n === '바른 생활' || n === '슬기로운 생활' || n === '즐거운 생활') ? '통합교과' : n;
        if (!seen[name]) { seen[name] = 1; out.push(name); }
      });
      return out;
    }

    /** 교과 × 주요 개념 교집합 — 호출 없음 */
    function localCandidates() {
      var want = state.keyConcepts || [];
      if (!want.length) return [];
      var out = [];
      ((rel && rel.bySubject) || []).forEach(function (entry) {
        if (subjectsForConcepts().indexOf(entry.subject) < 0) return;
        var hits = [];
        (entry.concepts || []).forEach(function (c) {
          var tags = c.keyConcepts || [];
          var matched = want.filter(function (k) { return tags.indexOf(k) >= 0; });
          if (matched.length) hits.push({ name: c.name, via: matched });
        });
        if (hits.length) out.push({ subject: entry.subject, items: hits });
      });
      return out;
    }

    /** 주요 개념축의 씨앗 낱말 — 교과 교집합이 빈약할 때 곁들인다 */
    function seedCandidates() {
      var want = state.keyConcepts || [];
      var out = [];
      ((rel && rel.byKeyConcept) || []).forEach(function (e) {
        if (want.indexOf(e.keyConcept) < 0) return;
        out.push({ ko: e.ko, items: (e.seed || []).concat(e.extended || []).slice(0, 10) });
      });
      return out;
    }

    function ensure() {
      return Promise.all([loadData('pyp-framework'), loadData('related-concepts')])
        .then(function (r) { fw = r[0]; rel = r[1]; return true; });
    }

    /* ---- 그리기 ---- */
    function paintKey() {
      var picked = state.keyConcepts || [];
      var full = picked.length >= KEY_MAX;
      var h = '<h3 class="block__title"><span class="block__ord">1</span>주요 개념 고르기</h3>' +
              '<p class="block__hint">이 단원을 무엇으로 꿰뚫을지 정합니다. 최대 세 개까지, 지금 ' +
              picked.length + '개를 골랐습니다. 방금 쓰신 중심 아이디어를 다시 읽어 보시면 고르기 쉽습니다.</p>';

      if (state.centralIdea) {
        h += '<div class="anchor"><p class="anchor__src">지금의 중심 아이디어</p>' +
             '<p class="anchor__text">' + esc(state.centralIdea) + '</p></div>';
      }
      h += '<div class="cards">';
      keyConceptList().forEach(function (k) {
        var on = picked.indexOf(k.id) >= 0;
        h += '<button class="kc" type="button" data-act="key" data-v="' + esc(k.id) + '"' +
             ' aria-pressed="' + (on ? 'true' : 'false') + '" data-full="' + (full ? 'true' : 'false') + '">' +
             '<span class="kc__top"><span class="kc__ko">' + esc(k.ko) + '</span>' +
             '<span class="kc__q">' + esc(k.keyQuestion) + '</span></span>' +
             '<span class="kc__def">' + esc(k.definition) + '</span></button>';
      });
      $('#s3-key').innerHTML = h + '</div>';
    }

    function chip(name, isNew) {
      var on = (state.relatedConcepts || []).indexOf(name) >= 0;
      return '<button class="rc' + (isNew ? ' rc--new' : '') + '" type="button" data-act="rel" data-v="' +
             esc(name) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(name) + '</button>';
    }

    function paintRel() {
      var box = $('#s3-rel');
      if (!(state.keyConcepts || []).length) { box.innerHTML = ''; return; }

      var guide = (rel && rel.selectionGuide) || {};
      var n = (state.relatedConcepts || []).length;
      var h = '<h3 class="block__title"><span class="block__ord">2</span>관련 개념 고르기</h3>' +
              '<p class="block__hint">' + esc(guide.countGuide || '') +
              ' 고르신 교과와 주요 개념이 겹치는 자리에서 뽑았습니다.</p>' +
              '<div class="rowbtns">' +
              '<button class="btn" type="button" data-act="more">더 제안받고 점검하기</button>' +
              '<span class="count">고른 관련 개념 <strong>' + n + '</strong>개</span></div>' +
              '<p class="notice notice--info" id="s3-msg" hidden></p>';

      var local = localCandidates();
      local.forEach(function (g) {
        h += '<div class="rcgroup"><p class="rcgroup__head">' + esc(g.subject) + '</p><div class="chips">';
        g.items.forEach(function (it) { h += chip(it.name, false); });
        h += '</div></div>';
      });

      if (!local.length) {
        h += '<p class="block__hint" style="margin-left:0">고르신 교과에서 맞물리는 개념을 찾지 못했습니다. ' +
             '아래 개념축 낱말에서 고르거나 제안을 받아 보세요.</p>';
      }

      seedCandidates().forEach(function (g) {
        h += '<div class="rcgroup"><p class="rcgroup__head">' + esc(g.ko) +
             '<span class="rcgroup__from">개념축에서</span></p><div class="chips">';
        g.items.forEach(function (nm) { h += chip(nm, false); });
        h += '</div></div>';
      });

      if (suggested.length) {
        h += '<div class="rcgroup"><p class="rcgroup__head">추가 제안' +
             '<span class="rcgroup__from">이 단원에 맞춰 새로 제안한 것</span></p><div class="chips">';
        suggested.forEach(function (nm) { h += chip(nm, true); });
        h += '</div></div>';
      }

      var rv = state.conceptReview;
      if (rv && rv.text) {
        h += '<div class="review' + (rv.fit ? ' review--fit' : '') + '">' +
             '<p class="review__head">AI가 짚어본 것 — 판정이 아니라 검토 재료입니다</p>' +
             '<p class="review__body">' + esc(rv.text) + '</p></div>';
      }
      box.innerHTML = h;
    }

    function paintAll() {
      if (!fw || !rel) return;
      paintKey(); paintRel();
      saveDraft();
    }

    /* ---- 조작 ---- */
    function toggleKey(id) {
      var list = (state.keyConcepts || []).slice();
      var at = list.indexOf(id);
      if (at >= 0) list.splice(at, 1);
      else {
        if (list.length >= KEY_MAX) {
          setStatus('주요 개념은 세 개까지 고를 수 있습니다. 하나를 빼고 다시 골라 주세요.', 'stop');
          return;
        }
        list.push(id);
      }
      state.keyConcepts = list;
      setStatus('8단계 가운데 3단계입니다.');
      // 주요 개념이 바뀌면 이전 검토 의견은 더 이상 맞지 않는다.
      state.conceptReview = null;
      paintAll();
    }

    function toggleRel(name) {
      var list = (state.relatedConcepts || []).slice();
      var at = list.indexOf(name);
      if (at >= 0) list.splice(at, 1); else list.push(name);
      state.relatedConcepts = list;
      paintAll();
    }

    /* ---- 제안 + 검토 (한 번의 호출) ---- */
    function buildPrompt() {
      var picked = (state.keyConcepts || []).map(function (id) {
        var k = null;
        keyConceptList().forEach(function (x) { if (x.id === id) k = x; });
        return k ? ('- ' + k.ko + ' (' + k.keyQuestion + ')') : '- ' + id;
      }).join('\n');

      var already = (state.relatedConcepts || []).join(', ');
      var pool = [];
      localCandidates().forEach(function (g) {
        g.items.forEach(function (it) { pool.push(it.name); });
      });
      var stds = (state.standards || []).map(function (o) {
        return '- ' + o.code + ' ' + o.text;
      }).join('\n');
      var cautions = ((rel && rel.selectionGuide && rel.selectionGuide.cautions) || [])
        .map(function (c) { return '- ' + c; }).join('\n');

      return '당신은 IB PYP 초학문적 탐구 단원을 설계하는 한국 초등학교 교사를 돕는다.\n' +
             '교사가 이미 주요 개념을 골랐다. 그 선택을 존중하되, 검토할 지점이 있으면 알려 준다.\n\n' +
             '[학년] ' + state.grade + '학년\n' +
             '[중심 아이디어] ' + (state.centralIdea || '') + '\n' +
             '[교사가 고른 주요 개념]\n' + picked + '\n' +
             (already ? '[교사가 이미 고른 관련 개념] ' + already + '\n' : '') +
             '[화면에 이미 있는 후보] ' + pool.join(', ') + '\n\n' +
             '[고른 성취기준]\n' + stds + '\n\n' +
             '[관련 개념을 고를 때의 주의]\n' + cautions + '\n\n' +
             '[할 일 두 가지]\n' +
             '1) 이 단원에 어울리는 관련 개념을 3~5개 새로 제안한다. ' +
             '화면에 이미 있는 후보와 교사가 이미 고른 것은 빼고, 겹치지 않는 낱말만 낸다. ' +
             '활동명이나 소재명이 아니라 개념 낱말로 낸다.\n' +
             '2) 교사가 고른 주요 개념이 중심 아이디어·성취기준과 잘 맞물리는지 두세 문장으로 짚는다. ' +
             '잘 맞으면 어디가 맞는지 말하고, 아쉬우면 무엇이 빠져 보이는지 말한다. ' +
             '단정하지 말고 교사가 판단할 여지를 남기는 말투로 쓴다. 고쳐야 한다고 명령하지 않는다.\n\n' +
             '[출력] 다음 형태의 JSON만 출력한다.\n' +
             '{ "related": ["관련 개념", "관련 개념"], "fit": true, "review": "짚어본 내용 두세 문장" }';
    }

    function more() {
      if (!(state.keyConcepts || []).length) { msg('주요 개념을 먼저 골라 주세요.', 'warn'); return; }
      var btn = $('#s3-rel [data-act="more"]');
      if (btn) { btn.disabled = true; btn.textContent = '살펴보는 중…'; }
      msg('중심 아이디어와 견주어 보는 중입니다. 15초쯤 걸립니다.', 'info');

      callGemini(buildPrompt()).then(function (res) {
        var got = (res && res.related) || [];
        var have = {};
        localCandidates().forEach(function (g) {
          g.items.forEach(function (it) { have[it.name] = 1; });
        });
        seedCandidates().forEach(function (g) {
          g.items.forEach(function (nm) { have[nm] = 1; });
        });
        suggested = got
          .map(function (x) { return String(x || '').trim(); })
          .filter(function (x) { return x && !have[x] && suggested.indexOf(x) < 0; });

        state.conceptReview = (res && res.review)
          ? { text: String(res.review), fit: res.fit !== false }
          : null;

        paintAll();
        msg(suggested.length
          ? '관련 개념 ' + suggested.length + '개를 새로 제안했습니다. 아래 점선 칩에서 골라 주세요.'
          : '새로 제안할 만한 개념이 없습니다. 위 후보에서 골라 주세요.', 'info');
      })['catch'](function (e) {
        paintAll();
        msg(msgOf(e), 'stop');
      });
    }

    function bindStep3() {
      var root = $('#step-3');
      root.addEventListener('click', function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el || !root.contains(el)) return;
        var v = el.getAttribute('data-v');
        switch (el.getAttribute('data-act')) {
          case 'key': toggleKey(v); break;
          case 'rel': toggleRel(v); break;
          case 'more': more(); break;
        }
      });
    }

    registerGuard(3, function (st) {
      var hard = [], soft = [];
      var kc = (st.keyConcepts || []).length;
      var rc = (st.relatedConcepts || []).length;
      if (!kc) hard.push('주요 개념을 하나 이상 골라 주세요.');
      else if (kc > 3) hard.push('주요 개념은 세 개까지만 고를 수 있습니다.');
      if (!hard.length) {
        if (!rc) soft.push('관련 개념을 아직 고르지 않았습니다.');
        else if (rc > kc * 2) {
          soft.push('관련 개념이 ' + rc + '개입니다. 주요 개념 하나당 한둘이 자연스럽습니다.');
        }
      }
      return { hard: hard, soft: soft };
    });

    function init() {
      bindStep3();
      ensure().then(paintAll)['catch'](function () { /* 데이터가 없으면 조용히 넘어간다 */ });
    }

    return { init: init, repaint: paintAll };
  })();

  /* ============================================================
   * 4단계 — 탐구 목록
   *   중심 아이디어를 세 갈래로 펼친다.
   *   개념 태그는 여러 개를 붙일 수 있다(1:1 매핑을 강제하지 않는다).
   * ============================================================ */
  var S4 = (function () {
    var fw = null;
    var WANT = 3;

    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function msg(text, tone) {
      var el = $('#s4-msg');
      if (!el) return;
      if (!text) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = text;
      el.className = 'notice notice--' + (tone || 'info');
    }
    function koOf(id) {
      var hit = id;
      ((fw && fw.keyConcepts) || []).forEach(function (k) { if (k.id === id) hit = k.ko; });
      return hit;
    }
    function lines() {
      if (!Array.isArray(state.linesOfInquiry)) state.linesOfInquiry = [];
      return state.linesOfInquiry;
    }

    function ensure() {
      return loadData('pyp-framework').then(function (d) { fw = d; return true; });
    }

    /* ---- 그리기 ---- */
    function paintGen() {
      var has = lines().length > 0;
      var h = '<h3 class="block__title"><span class="block__ord">1</span>탐구 목록 만들기</h3>' +
              '<p class="block__hint">중심 아이디어를 세 갈래로 펼칩니다. 각 갈래는 학생이 무엇을 파고들지 ' +
              '한 줄로 나타냅니다. 받은 뒤 얼마든지 고쳐 쓸 수 있고, 직접 추가할 수도 있습니다.</p>';

      if (state.centralIdea) {
        h += '<div class="anchor"><p class="anchor__src">중심 아이디어</p>' +
             '<p class="anchor__text">' + esc(state.centralIdea) + '</p></div>';
      }
      h += '<div class="rowbtns">' +
           '<button class="btn btn--primary" type="button" data-act="gen">' +
           (has ? '다시 받기' : '세 갈래 받기') + '</button>' +
           '<button class="btn" type="button" data-act="add">직접 추가</button>' +
           '</div><p class="notice notice--info" id="s4-msg" hidden></p>';
      $('#s4-gen').innerHTML = h;
    }

    function paintList() {
      var box = $('#s4-list');
      var arr = lines();
      if (!arr.length) { box.innerHTML = ''; return; }

      var picked = state.keyConcepts || [];
      var h = '<h3 class="block__title"><span class="block__ord">2</span>개념 태그 붙이기</h3>' +
              '<p class="block__hint">각 갈래가 어떤 주요 개념을 다루는지 표시합니다. ' +
              '한 갈래에 두 개념이 걸려도 괜찮고, 한 개념이 여러 갈래에 걸쳐도 괜찮습니다.</p>';

      arr.forEach(function (item, i) {
        h += '<div class="loi"><div class="loi__head">' +
             '<span class="loi__ord">' + (i + 1) + '</span>' +
             '<span class="pick__meta">탐구 목록 ' + (i + 1) + '</span>' +
             '<button class="loi__del" type="button" data-act="del" data-i="' + i + '">지우기</button>' +
             '</div>' +
             '<textarea class="loi__text" data-act="edit" data-i="' + i + '" ' +
             'placeholder="예: 규칙이 만들어지는 과정">' + esc(item.text || '') + '</textarea>' +
             '<div class="loi__tags"><span class="loi__label">개념</span>';
        picked.forEach(function (id) {
          var on = (item.concepts || []).indexOf(id) >= 0;
          h += '<button class="tagbtn" type="button" data-act="tag" data-i="' + i + '" data-v="' + esc(id) + '"' +
               ' aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(koOf(id)) + '</button>';
        });
        h += '</div></div>';
      });

      // 고른 주요 개념 가운데 어디에도 안 붙은 것을 알려 준다
      var used = {};
      arr.forEach(function (it) { (it.concepts || []).forEach(function (c) { used[c] = 1; }); });
      var miss = picked.filter(function (id) { return !used[id]; });
      h += '<div class="coverage"><b>탐구 목록 ' + arr.length + '개</b>';
      if (miss.length) {
        h += '<span class="coverage__miss">' + miss.map(koOf).join(' · ') + ' 아직 안 붙음</span>';
      } else if (picked.length) {
        h += '<span>고르신 주요 개념이 모두 어딘가에 걸려 있습니다.</span>';
      }
      h += '</div>';
      box.innerHTML = h;
    }

    function paintAll() {
      if (!fw) return;
      paintGen(); paintList();
      saveDraft();
    }

    /* ---- 생성 ---- */
    function buildPrompt() {
      var kc = (state.keyConcepts || []).map(function (id) {
        var k = null;
        ((fw && fw.keyConcepts) || []).forEach(function (x) { if (x.id === id) k = x; });
        return k ? ('- ' + k.ko + ' (' + k.id + '): ' + k.keyQuestion) : ('- ' + id);
      }).join('\n');
      var rc = (state.relatedConcepts || []).join(', ');
      var stds = (state.standards || []).map(function (o) {
        return '- ' + o.code + ' ' + o.text;
      }).join('\n');

      return '당신은 IB PYP 초학문적 탐구 단원을 설계하는 한국 초등학교 교사를 돕는다.\n\n' +
             '[학년] ' + state.grade + '학년\n' +
             '[중심 아이디어] ' + (state.centralIdea || '') + '\n' +
             '[주요 개념]\n' + kc + '\n' +
             (rc ? '[관련 개념] ' + rc + '\n' : '') + '\n' +
             '[고른 성취기준]\n' + stds + '\n\n' +
             '[할 일] 이 중심 아이디어를 파고드는 탐구 목록(lines of inquiry) 3개를 만든다.\n' +
             '탐구 목록의 조건:\n' +
             '- 질문이 아니라 명사구로 쓴다. 물음표를 쓰지 않는다.\n' +
             '  좋은 예: 규칙이 만들어지는 과정 / 공동체마다 다른 약속의 모습\n' +
             '  나쁜 예: 규칙은 어떻게 만들어질까? / 규칙 만들기 활동하기\n' +
             '- 활동명이 아니라 탐구할 내용으로 쓴다.\n' +
             '- 셋을 합치면 중심 아이디어 전체가 덮이도록 서로 다른 갈래를 잡는다.\n' +
             '- ' + state.grade + '학년 학생이 읽고 무엇을 알아볼지 짐작할 수 있는 낱말로 쓴다.\n' +
             '- 각 갈래에 어떤 주요 개념이 걸리는지 위 목록의 영문 id로 표시한다. ' +
             '하나에 두 개념이 걸려도 되고, 셋을 합쳐 고른 개념이 모두 한 번은 나오게 한다.\n\n' +
             '[출력] 다음 형태의 JSON만 출력한다.\n' +
             '{ "lines": [ { "text": "탐구 목록 한 줄", "concepts": ["function"] } ] }';
    }

    function generate() {
      if (!state.centralIdea) { msg('2단계에서 중심 아이디어를 먼저 써 주세요.', 'warn'); return; }
      if (!(state.keyConcepts || []).length) { msg('3단계에서 주요 개념을 먼저 골라 주세요.', 'warn'); return; }

      var btn = $('#s4-gen [data-act="gen"]');
      if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }
      msg('중심 아이디어를 세 갈래로 펼치는 중입니다. 15초쯤 걸립니다.', 'info');

      callGemini(buildPrompt()).then(function (res) {
        var got = (res && res.lines) || [];
        var picked = state.keyConcepts || [];
        state.linesOfInquiry = got
          .filter(function (l) { return l && l.text; })
          .slice(0, 4)
          .map(function (l) {
            var tags = (l.concepts || []).filter(function (c) { return picked.indexOf(c) >= 0; });
            return { text: String(l.text).trim().replace(/\?$/, ''), concepts: tags };
          });
        paintAll();
        msg(state.linesOfInquiry.length
          ? '탐구 목록 ' + state.linesOfInquiry.length + '개를 만들었습니다. 우리 반 말로 고쳐 쓰고 개념 태그를 확인해 주세요.'
          : '탐구 목록을 만들지 못했습니다. 다시 눌러 주세요.', 'info');
      })['catch'](function (e) {
        paintAll();
        msg(msgOf(e), 'stop');
      });
    }

    /* ---- 조작 ---- */
    function addOne() {
      lines().push({ text: '', concepts: [] });
      paintAll();
      var boxes = $$('#s4-list .loi__text');
      if (boxes.length) boxes[boxes.length - 1].focus();
    }
    function delOne(i) {
      var arr = lines();
      if (i < 0 || i >= arr.length) return;
      arr.splice(i, 1);
      paintAll();
    }
    function toggleTag(i, id) {
      var item = lines()[i];
      if (!item) return;
      item.concepts = item.concepts || [];
      var at = item.concepts.indexOf(id);
      if (at >= 0) item.concepts.splice(at, 1); else item.concepts.push(id);
      // 태그만 바뀌었으므로 편집 중인 글은 건드리지 않는다
      var btn = $('#s4-list [data-act="tag"][data-i="' + i + '"][data-v="' + id + '"]');
      if (btn) btn.setAttribute('aria-pressed', at >= 0 ? 'false' : 'true');
      paintCoverage();
      saveDraft();
    }
    function paintCoverage() {
      var box = $('#s4-list .coverage');
      if (!box) return;
      var picked = state.keyConcepts || [];
      var used = {};
      lines().forEach(function (it) { (it.concepts || []).forEach(function (c) { used[c] = 1; }); });
      var miss = picked.filter(function (id) { return !used[id]; });
      var h = '<b>탐구 목록 ' + lines().length + '개</b>';
      if (miss.length) h += '<span class="coverage__miss">' + miss.map(koOf).join(' · ') + ' 아직 안 붙음</span>';
      else if (picked.length) h += '<span>고르신 주요 개념이 모두 어딘가에 걸려 있습니다.</span>';
      box.innerHTML = h;
    }

    function bindStep4() {
      var root = $('#step-4');
      root.addEventListener('click', function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el || !root.contains(el)) return;
        var act = el.getAttribute('data-act');
        if (act === 'gen') generate();
        if (act === 'add') addOne();
        if (act === 'del') delOne(Number(el.getAttribute('data-i')));
        if (act === 'tag') toggleTag(Number(el.getAttribute('data-i')), el.getAttribute('data-v'));
      });
      root.addEventListener('input', function (ev) {
        var t = ev.target;
        if (t && t.matches && t.matches('[data-act="edit"]')) {
          var item = lines()[Number(t.getAttribute('data-i'))];
          if (item) { item.text = t.value; saveDraft(); }
        }
      });
    }

    registerGuard(4, function (st) {
      var hard = [], soft = [];
      var arr = (st.linesOfInquiry || []).filter(function (l) { return String(l.text || '').trim(); });
      if (!arr.length) hard.push('탐구 목록을 하나 이상 써 주세요.');

      if (!hard.length) {
        if (arr.length !== WANT) {
          soft.push('탐구 목록이 ' + arr.length + '개입니다. 보통 세 개로 씁니다.');
        }
        var q = arr.filter(function (l) { return /[?？]/.test(l.text); });
        if (q.length) soft.push('탐구 목록에 물음표가 있습니다. 질문은 5단계에서 따로 씁니다.');

        var noTag = arr.filter(function (l) { return !(l.concepts || []).length; });
        if (noTag.length) soft.push('개념 태그가 없는 탐구 목록이 ' + noTag.length + '개 있습니다.');

        var used = {};
        arr.forEach(function (l) { (l.concepts || []).forEach(function (c) { used[c] = 1; }); });
        var miss = (st.keyConcepts || []).filter(function (id) { return !used[id]; });
        if (miss.length) {
          soft.push('주요 개념 가운데 ' + miss.map(koOf).join(' · ') + ' 항목이 어느 탐구 목록에도 걸려 있지 않습니다.');
        }
      }
      return { hard: hard, soft: soft };
    });

    function init() {
      bindStep4();
      ensure().then(paintAll)['catch'](function () { /* 데이터가 없으면 조용히 넘어간다 */ });
    }

    return { init: init, repaint: paintAll };
  })();

  /* ============================================================
   * 5단계 — 질문
   *   탐구 목록마다 교사 발문(사실·개념·논쟁)과 예상 학생 질문을 마련한다.
   *   교사 발문은 유형을 나눠 두어야 탐구가 사실 확인에 머물지 않는다.
   * ============================================================ */
  var S5 = (function () {
    var fw = null;
    // 순서가 곧 탐구의 흐름이다: 사례를 모으고(사실) → 개념을 뽑아내고(형성)
    // → 개념끼리의 관계를 묻고(개념) → 근거를 들어 견준다(논쟁).
    var TYPES = ['사실', '형성', '개념', '논쟁'];

    // 개념 형성 질문의 다섯 갈래. 초등에서 실제로 통하는 것만 추렸다.
    // 화면 안내와 프롬프트가 같은 목록을 쓰도록 한 곳에 둔다.
    var FORMING = [
      { ko: '공통점 찾기', why: '사례를 나란히 놓고 무엇이 되풀이되는지 본다',
        ex: '이 약속들에서 함께 나타나는 점은 무엇인가요?' },
      { ko: '나누어 보기', why: '기준을 세워 나누는 동안 개념의 테두리가 생긴다',
        ex: '이것들을 두 무리로 나눈다면 어떤 기준으로 나눌 수 있을까요?' },
      { ko: '경계 시험하기', why: '되는 것과 안 되는 것의 까닭을 물어 테두리를 또렷하게 한다',
        ex: '이것도 규칙이라고 할 수 있을까요? 왜 그런가요?' },
      { ko: '반례 던지기', why: '어긋나는 사례를 일부러 보여 개념을 다시 살피게 한다',
        ex: '아무도 지키지 않는 약속도 규칙일까요?' },
      { ko: '이름 붙이기', why: '사례 묶음에 학생이 직접 이름을 지으며 개념에 이른다',
        ex: '이 무리에 이름을 붙인다면 뭐라고 부르면 좋을까요?' }
    ];

    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function msg(text, tone) {
      var el = $('#s5-msg');
      if (!el) return;
      if (!text) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = text;
      el.className = 'notice notice--' + (tone || 'info');
    }
    function koOf(id) {
      var hit = id;
      ((fw && fw.keyConcepts) || []).forEach(function (k) { if (k.id === id) hit = k.ko; });
      return hit;
    }
    function loi() {
      return (state.linesOfInquiry || []).filter(function (l) { return String(l.text || '').trim(); });
    }
    /** 탐구 목록 순서에 맞춰 질문 칸을 준비한다. */
    function slots() {
      if (!Array.isArray(state.teacherQuestions)) state.teacherQuestions = [];
      if (!Array.isArray(state.studentQuestions)) state.studentQuestions = [];
      var n = loi().length;
      while (state.teacherQuestions.length < n) state.teacherQuestions.push([]);
      while (state.studentQuestions.length < n) state.studentQuestions.push([]);
      state.teacherQuestions.length = n;
      state.studentQuestions.length = n;
      return n;
    }

    function ensure() {
      return loadData('pyp-framework').then(function (d) { fw = d; return true; });
    }

    /* ---- 그리기 ---- */
    function paintGen() {
      var has = (state.teacherQuestions || []).some(function (a) { return (a || []).length; });
      var h = '<h3 class="block__title"><span class="block__ord">1</span>질문 마련하기</h3>' +
              '<p class="block__hint">탐구 목록마다 교사가 던질 발문과, 학생이 던질 법한 질문을 미리 그려 둡니다. ' +
              '아래 네 결은 탐구가 나아가는 순서이기도 합니다. 사례를 모으고, 거기서 개념을 뽑아내고, ' +
              '개념끼리의 관계를 묻고, 마지막에 근거를 들어 견줍니다.</p>' +
              '<div class="qlegend">' +
              '<span><b>사실</b> 자료나 관찰로 답이 정해지는 질문</span>' +
              '<span><b>형성</b> 여러 사례에서 개념을 뽑아내게 하는 질문</span>' +
              '<span><b>개념</b> 개념과 개념의 관계를 묻는 질문</span>' +
              '<span><b>논쟁</b> 답이 갈리고 근거를 대야 하는 질문</span>' +
              '</div>' +
              '<details class="group" id="s5-forming"><summary>형성 질문은 어떻게 만드나요' +
              '<span class="group__count">다섯 갈래</span></summary><div class="formways">';
      FORMING.forEach(function (f) {
        h += '<div class="formway"><p class="formway__ko">' + esc(f.ko) +
             '<span class="formway__why">' + esc(f.why) + '</span></p>' +
             '<p class="formway__ex">' + esc(f.ex) + '</p></div>';
      });
      h += '</div></details>' +
              '<div class="rowbtns">' +
              '<button class="btn btn--primary" type="button" data-act="gen">' +
              (has ? '다시 받기' : '질문 받기') + '</button></div>' +
              '<p class="notice notice--info" id="s5-msg" hidden></p>';
      $('#s5-gen').innerHTML = h;
    }

    function qrow(kind, i, j, item) {
      var t = (item && item.type) || '사실';
      var text = (item && item.text) || '';
      var h = '<div class="qrow">';
      if (kind === 't') {
        h += '<button class="qrow__type" type="button" data-act="type" data-i="' + i + '" data-j="' + j + '"' +
             ' data-t="' + esc(t) + '" title="누르면 결이 바뀝니다">' + esc(t) + '</button>';
      } else {
        h += '<span class="qrow__type">학생</span>';
      }
      h += '<textarea class="qrow__in" data-act="edit" data-k="' + kind + '" data-i="' + i + '" data-j="' + j + '"' +
           ' rows="1" placeholder="' + (kind === 't' ? '교사 발문' : '학생이 던질 법한 질문') + '">' +
           esc(text) + '</textarea>' +
           (item && item.way ? '<span class="qrow__way">' + esc(item.way) + '</span>' : '') +
           '<button class="qrow__del" type="button" data-act="del" data-k="' + kind + '" data-i="' + i + '" data-j="' + j + '"' +
           ' aria-label="지우기">×</button></div>';
      return h;
    }

    function paintList() {
      var box = $('#s5-list');
      var arr = loi();
      if (!arr.length) {
        box.innerHTML = '<p class="block__hint" style="margin-left:0">4단계에서 탐구 목록을 먼저 써 주세요.</p>';
        return;
      }
      slots();

      var h = '<h3 class="block__title"><span class="block__ord">2</span>탐구 목록별 질문</h3>' +
              '<p class="block__hint">받은 질문은 우리 반 말로 고쳐 쓰고, 필요 없으면 지우세요. ' +
              '발문 왼쪽의 결 표시를 누르면 사실 · 형성 · 개념 · 논쟁으로 바뀝니다.</p>';

      arr.forEach(function (l, i) {
        h += '<div class="qloi"><div class="qloi__head">' +
             '<span class="qloi__ord">' + (i + 1) + '</span>' +
             '<span class="qloi__text">' + esc(l.text) + '</span>';
        (l.concepts || []).forEach(function (c) {
          h += '<span class="qloi__tag">' + esc(koOf(c)) + '</span>';
        });
        h += '</div>';

        h += '<div class="qgroup"><p class="qgroup__head">교사 발문' +
             '<span class="qgroup__note">사실 → 형성 → 개념 → 논쟁 순으로 이어집니다</span></p>';
        (state.teacherQuestions[i] || []).forEach(function (q, j) { h += qrow('t', i, j, q); });
        h += '<button class="qadd" type="button" data-act="add" data-k="t" data-i="' + i + '">발문 추가</button></div>';

        h += '<div class="qgroup"><p class="qgroup__head">예상 학생 질문' +
             '<span class="qgroup__note">도입에서 아이들이 꺼낼 법한 말</span></p>';
        (state.studentQuestions[i] || []).forEach(function (q, j) { h += qrow('s', i, j, q); });
        h += '<button class="qadd" type="button" data-act="add" data-k="s" data-i="' + i + '">질문 추가</button></div>';

        h += '</div>';
      });
      box.innerHTML = h;
    }

    function paintAll() {
      if (!fw) return;
      paintGen(); paintList();
      saveDraft();
    }

    /* ---- 생성 ---- */
    function buildPrompt() {
      var arr = loi();
      var body = arr.map(function (l, i) {
        var tags = (l.concepts || []).map(koOf).join(', ');
        return (i + 1) + ') ' + l.text + (tags ? ' [개념: ' + tags + ']' : '');
      }).join('\n');
      var rc = (state.relatedConcepts || []).join(', ');

      return '당신은 IB PYP 초학문적 탐구 단원을 설계하는 한국 초등학교 교사를 돕는다.\n\n' +
             '[학년] ' + state.grade + '학년\n' +
             '[중심 아이디어] ' + (state.centralIdea || '') + '\n' +
             (rc ? '[관련 개념] ' + rc + '\n' : '') + '\n' +
             '[탐구 목록]\n' + body + '\n\n' +
             '[할 일] 탐구 목록마다 다음 두 가지를 만든다.\n\n' +
             '1) 교사 발문 4개. 아래 네 결을 하나씩 만든다. 이 순서가 곧 탐구가 나아가는 순서다.\n' +
             '   - 사실: 자료를 찾거나 관찰하면 답이 정해지는 질문.\n' +
             '     예) 우리 학교에는 어떤 약속이 있나요?\n' +
             '   - 형성: 모아 놓은 사례에서 개념을 뽑아내게 하는 질문. ' +
             '개념의 뜻을 아직 모르는 상태에서 스스로 개념에 이르게 한다. ' +
             '개념을 이미 아는 것으로 전제하고 묻지 않는다.\n' +
             '     아래 다섯 갈래 가운데 하나를 골라 만든다. 탐구 목록마다 서로 다른 갈래를 골라, ' +
             '세 목록의 형성 질문이 모두 같은 형태가 되지 않게 한다.\n' +
             FORMING.map(function (f) {
               return '     · ' + f.ko + ' — ' + f.why + '. 예) ' + f.ex;
             }).join('\n') + '\n' +
             '     way 항목에 어느 갈래를 썼는지 위 이름 그대로 적는다.\n' +
             '   - 개념: 개념과 개념의 관계를 묻는 질문. 특정 사례에만 통하면 안 되고, 여러 사례에 걸쳐 통해야 한다.\n' +
             '     예) 규칙은 공동체에 어떤 영향을 주나요?\n' +
             '   - 논쟁: 답이 하나로 모이지 않고 근거를 들어 견주어야 하는 질문.\n' +
             '     예) 규칙을 정할 때 모두의 의견을 들어야 할까요?\n\n' +
             '2) 예상 학생 질문 2개. 단원을 열었을 때 ' + state.grade + '학년 아이가 실제로 꺼낼 법한 말투로 쓴다. ' +
             '어른의 정돈된 말이 아니라 아이의 소박한 궁금증으로 쓴다.\n\n' +
             '공통 조건:\n' +
             '- 모든 질문은 물음표로 끝낸다.\n' +
             '- ' + state.grade + '학년이 알아들을 낱말로 쓴다.\n' +
             '- 예 아니오로 끝나는 질문은 피한다.\n' +
             '- 고유명사와 특정 지명·인명을 넣지 않는다.\n\n' +
             '[출력] 다음 형태의 JSON만 출력한다. lines 배열의 순서는 위 탐구 목록 순서와 같게 한다.\n' +
             '{ "lines": [ { "teacher": [ { "type": "형성", "way": "나누어 보기", "text": "발문" } ], ' +
             '"student": ["학생 질문"] } ] }\n' +
             'way는 형성 질문에만 넣고 나머지 결에는 넣지 않는다.';
    }

    function generate() {
      if (!loi().length) { msg('4단계에서 탐구 목록을 먼저 써 주세요.', 'warn'); return; }
      var btn = $('#s5-gen [data-act="gen"]');
      if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }
      msg('탐구 목록마다 발문과 학생 질문을 짓는 중입니다. 20초쯤 걸립니다.', 'info');

      callGemini(buildPrompt()).then(function (res) {
        var got = (res && res.lines) || [];
        var n = loi().length;
        var tq = [], sq = [];
        for (var i = 0; i < n; i++) {
          var one = got[i] || {};
          tq.push((one.teacher || []).filter(function (q) { return q && q.text; }).map(function (q) {
            var t = String(q.type || '').trim();
            var kind = TYPES.indexOf(t) >= 0 ? t : '사실';
            var out = { type: kind, text: String(q.text).trim() };
            if (kind === '형성' && q.way) {
              var w = String(q.way).trim();
              var known = FORMING.some(function (f) { return f.ko === w; });
              if (known) out.way = w;
            }
            return out;
          }));
          sq.push((one.student || []).map(function (q) {
            return { text: String(typeof q === 'string' ? q : (q && q.text) || '').trim() };
          }).filter(function (q) { return q.text; }));
        }
        state.teacherQuestions = tq;
        state.studentQuestions = sq;
        paintAll();

        var total = tq.reduce(function (a, b) { return a + b.length; }, 0);
        msg(total
          ? '발문 ' + total + '개와 학생 질문을 만들었습니다. 우리 반 말로 고쳐 쓰세요.'
          : '질문을 만들지 못했습니다. 다시 눌러 주세요.', total ? 'info' : 'warn');
      })['catch'](function (e) {
        paintAll();
        msg(msgOf(e), 'stop');
      });
    }

    /* ---- 조작 ---- */
    function bucket(kind, i) {
      slots();
      var arr = kind === 't' ? state.teacherQuestions : state.studentQuestions;
      if (!arr[i]) arr[i] = [];
      return arr[i];
    }
    function addOne(kind, i) {
      bucket(kind, i).push(kind === 't' ? { type: '사실', text: '' } : { text: '' });
      paintAll();
      var sel = '#s5-list [data-act="edit"][data-k="' + kind + '"][data-i="' + i + '"]';
      var boxes = $$(sel);
      if (boxes.length) boxes[boxes.length - 1].focus();
    }
    function delOne(kind, i, j) {
      var b = bucket(kind, i);
      if (j < 0 || j >= b.length) return;
      b.splice(j, 1);
      paintAll();
    }
    function rotate(i, j) {
      var b = bucket('t', i);
      if (!b[j]) return;
      var at = TYPES.indexOf(b[j].type);
      b[j].type = TYPES[(at + 1) % TYPES.length];
      // 결만 바뀌므로 편집 중인 글은 건드리지 않는다
      var btn = $('#s5-list [data-act="type"][data-i="' + i + '"][data-j="' + j + '"]');
      if (btn) { btn.setAttribute('data-t', b[j].type); btn.textContent = b[j].type; }
      saveDraft();
    }

    function bindStep5() {
      var root = $('#step-5');
      root.addEventListener('click', function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el || !root.contains(el)) return;
        var act = el.getAttribute('data-act');
        var i = Number(el.getAttribute('data-i'));
        var j = Number(el.getAttribute('data-j'));
        var k = el.getAttribute('data-k');
        if (act === 'gen') generate();
        if (act === 'add') addOne(k, i);
        if (act === 'del') delOne(k, i, j);
        if (act === 'type') rotate(i, j);
      });
      root.addEventListener('input', function (ev) {
        var t = ev.target;
        if (!t || !t.matches || !t.matches('[data-act="edit"]')) return;
        var b = bucket(t.getAttribute('data-k'), Number(t.getAttribute('data-i')));
        var item = b[Number(t.getAttribute('data-j'))];
        if (item) { item.text = t.value; saveDraft(); }
      });
    }

    registerGuard(5, function (st) {
      var hard = [], soft = [];
      var arr = (st.linesOfInquiry || []).filter(function (l) { return String(l.text || '').trim(); });
      var tq = st.teacherQuestions || [];
      var filled = function (list) {
        return (list || []).filter(function (q) { return String(q.text || '').trim(); });
      };
      var any = tq.some(function (a) { return filled(a).length; });
      if (!any) hard.push('교사 발문을 하나 이상 써 주세요.');

      if (!hard.length) {
        var empty = [];
        arr.forEach(function (l, i) { if (!filled(tq[i]).length) empty.push(i + 1); });
        if (empty.length) soft.push('탐구 목록 ' + empty.join(' · ') + '번에 발문이 없습니다.');

        var noConcept = [], jump = [];
        arr.forEach(function (l, i) {
          var kinds = {};
          filled(tq[i]).forEach(function (q) { kinds[q.type] = 1; });
          if (!kinds['개념']) noConcept.push(i + 1);
          // 개념을 뽑아내는 걸음 없이 관계부터 물으면 교사만 아는 대화가 되기 쉽다
          else if (!kinds['형성']) jump.push(i + 1);
        });
        if (noConcept.length) {
          soft.push('탐구 목록 ' + noConcept.join(' · ') + '번에 개념 질문이 없습니다. 사실 확인에 머물 수 있습니다.');
        }
        if (jump.length) {
          soft.push('탐구 목록 ' + jump.join(' · ') + '번에 형성 질문 없이 개념 질문만 있습니다. ' +
                    '학생이 개념을 잡기 전에 관계부터 묻게 될 수 있습니다.');
        }

        var noStudent = (st.studentQuestions || []).every(function (a) { return !filled(a).length; });
        if (noStudent) soft.push('예상 학생 질문이 비어 있습니다.');
      }
      return { hard: hard, soft: soft };
    });

    function init() {
      bindStep5();
      ensure().then(paintAll)['catch'](function () { /* 데이터가 없으면 조용히 넘어간다 */ });
    }

    return { init: init, repaint: paintAll };
  })();

  /* ============================================================
   * 6단계 — 평가
   *   ① 진단·형성·총괄 세 가지와 도달 기준을 한 번에 받는다.
   *   ② 총괄평가를 써 본 뒤, 원하면 GRASPS 또는 RAFTS 틀로 펼친다(별도 호출).
   *      두 틀은 항목이 서로 달라 내용이 이월되지 않는다.
   * ============================================================ */
  var S6 = (function () {
    var fw = null;

    var THREE = [
      { id: 'diagnostic', ko: '진단평가', when: '단원 열 때',
        why: '학생이 이미 무엇을 알고 있고 어떤 오개념을 가졌는지 살핍니다.' },
      { id: 'formative', ko: '형성평가', when: '탐구하는 동안',
        why: '탐구가 흘러가는 중에 이해가 어디쯤 왔는지 확인하고 수업을 조정합니다.' },
      { id: 'summative', ko: '총괄평가', when: '단원 닫을 때',
        why: '중심 아이디어에 이르렀는지를 학생이 드러내 보이는 자리입니다.' }
    ];

    var CRIT = [
      { id: 'knowledge', ko: '지식', why: '무엇을 알게 되는가' },
      { id: 'understanding', ko: '이해', why: '무엇을 이해하게 되는가' },
      { id: 'skills', ko: '기능', why: '무엇을 할 수 있게 되는가' }
    ];

    var FRAMES = {
      grasps: {
        ko: 'GRASPS', note: '실제 상황 속에서 무언가를 해내는 수행 과제에 어울립니다.',
        slots: [
          { id: 'goal', ko: '목표', en: 'Goal', hint: '무엇을 이루어야 하는 상황인가' },
          { id: 'role', ko: '역할', en: 'Role', hint: '학생이 누구가 되는가' },
          { id: 'audience', ko: '청중', en: 'Audience', hint: '누구를 향해 하는 일인가' },
          { id: 'situation', ko: '상황', en: 'Situation', hint: '어떤 형편에 놓여 있는가' },
          { id: 'product', ko: '산출물', en: 'Product', hint: '무엇을 만들어 내는가' },
          { id: 'standards', ko: '기준', en: 'Standards', hint: '무엇을 갖추어야 잘한 것인가' }
        ]
      },
      rafts: {
        ko: 'RAFTS', note: '글이나 발표처럼 목소리를 담아 표현하는 결과물에 어울립니다.',
        slots: [
          { id: 'role', ko: '역할', en: 'Role', hint: '누구의 목소리로 말하는가' },
          { id: 'audience', ko: '청중', en: 'Audience', hint: '누구에게 말하는가' },
          { id: 'format', ko: '형식', en: 'Format', hint: '어떤 형식으로 담는가' },
          { id: 'topic', ko: '주제', en: 'Topic', hint: '무엇에 대해 말하는가' },
          { id: 'strong', ko: '강한 동사', en: 'Strong verb', hint: '설득한다·고발한다처럼 태도를 담은 동사' }
        ]
      }
    };

    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function msg(id, text, tone) {
      var el = $(id);
      if (!el) return;
      if (!text) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = text;
      el.className = 'notice notice--' + (tone || 'info');
    }
    function A() {
      if (!state.assessment) state.assessment = {};
      var a = state.assessment;
      if (!a.criteria) a.criteria = { knowledge: '', understanding: '', skills: '' };
      if (!a.frameData) a.frameData = {};
      return a;
    }
    function koOf(id) {
      var hit = id;
      ((fw && fw.keyConcepts) || []).forEach(function (k) { if (k.id === id) hit = k.ko; });
      return hit;
    }
    function loi() {
      return (state.linesOfInquiry || []).filter(function (l) { return String(l.text || '').trim(); });
    }

    function ensure() {
      return loadData('pyp-framework').then(function (d) { fw = d; return true; });
    }

    /* ---- 그리기 ---- */
    function paintGen() {
      var a = A();
      var has = a.diagnostic || a.formative || a.summative;
      var h = '<h3 class="block__title"><span class="block__ord">1</span>평가 마련하기</h3>' +
              '<p class="block__hint">진단 · 형성 · 총괄 세 가지와 도달 기준을 함께 받습니다. ' +
              '받은 뒤 우리 반 사정에 맞게 고쳐 쓰세요.</p>';
      if (state.centralIdea) {
        h += '<div class="anchor"><p class="anchor__src">중심 아이디어</p>' +
             '<p class="anchor__text">' + esc(state.centralIdea) + '</p></div>';
      }
      h += '<div class="rowbtns">' +
           '<button class="btn btn--primary" type="button" data-act="gen">' +
           (has ? '다시 받기' : '평가 받기') + '</button></div>' +
           '<p class="notice notice--info" id="s6-msg" hidden></p>';
      $('#s6-gen').innerHTML = h;
    }

    function paintThree() {
      var a = A();
      var h = '<h3 class="block__title"><span class="block__ord">2</span>세 가지 평가</h3>' +
              '<p class="block__hint">언제 어떻게 볼지를 적습니다. 총괄평가는 아래에서 틀로 펼칠 수 있습니다.</p>';
      THREE.forEach(function (t) {
        h += '<div class="asm"><div class="asm__head">' +
             '<span class="asm__ko">' + esc(t.ko) + '</span>' +
             '<span class="asm__when">' + esc(t.when) + '</span></div>' +
             '<p class="asm__why">' + esc(t.why) + '</p>' +
             '<textarea class="asm__in" data-act="asm" data-k="' + t.id + '" ' +
             'placeholder="' + esc(t.ko) + ' 계획">' + esc(a[t.id] || '') + '</textarea></div>';
      });
      $('#s6-three').innerHTML = h;
    }

    function paintFrame() {
      var a = A();
      var h = '<h3 class="block__title"><span class="block__ord">3</span>총괄평가 틀로 펼치기 <span class="pick__meta">(선택)</span></h3>' +
              '<p class="block__hint">틀 없이 그대로 두셔도 됩니다. 수행 과제를 또렷하게 하고 싶을 때만 고르세요.</p>' +
              '<div class="frame">' +
              '<button class="frame__btn" type="button" data-act="frame" data-v="none"' +
              ' aria-pressed="' + (!a.frame ? 'true' : 'false') + '">틀 안 씀</button>' +
              '<button class="frame__btn" type="button" data-act="frame" data-v="grasps"' +
              ' aria-pressed="' + (a.frame === 'grasps' ? 'true' : 'false') + '">GRASPS</button>' +
              '<button class="frame__btn" type="button" data-act="frame" data-v="rafts"' +
              ' aria-pressed="' + (a.frame === 'rafts' ? 'true' : 'false') + '">RAFTS</button>' +
              '</div>';

      if (!a.frame) { $('#s6-frame').innerHTML = h; return; }

      var f = FRAMES[a.frame];
      h += '<p class="frame__note">' + esc(f.note) +
           ' 두 틀은 항목이 서로 달라, 틀을 바꾸면 여기 쓰신 내용은 옮겨지지 않습니다.</p>' +
           '<div class="rowbtns">' +
           '<button class="btn" type="button" data-act="fill">' + esc(f.ko) + ' 칸 채워받기</button>' +
           '<button class="btn" type="button" data-act="toSummative">이 내용으로 총괄평가 다시 쓰기</button>' +
           '</div><p class="notice notice--info" id="s6-fmsg" hidden></p>';

      f.slots.forEach(function (sl) {
        h += '<div class="slot"><label class="slot__key" for="s6-' + sl.id + '">' + esc(sl.ko) +
             '<small>' + esc(sl.en) + '</small></label>' +
             '<textarea class="slot__in" id="s6-' + sl.id + '" data-act="slot" data-k="' + sl.id + '" ' +
             'placeholder="' + esc(sl.hint) + '">' + esc((a.frameData || {})[sl.id] || '') + '</textarea></div>';
      });
      $('#s6-frame').innerHTML = h;
    }

    function paintCrit() {
      var a = A();
      var h = '<h3 class="block__title"><span class="block__ord">4</span>도달 기준</h3>' +
              '<p class="block__hint">이 단원을 마쳤을 때 학생이 어디까지 이르면 되는지 적습니다.</p>' +
              '<div class="crit">';
      CRIT.forEach(function (c) {
        h += '<div class="crit__cell"><p class="crit__ko">' + esc(c.ko) + '</p>' +
             '<p class="crit__why">' + esc(c.why) + '</p>' +
             '<textarea class="crit__in" data-act="crit" data-k="' + c.id + '" ' +
             'placeholder="' + esc(c.ko) + ' 도달 기준">' + esc(a.criteria[c.id] || '') + '</textarea></div>';
      });
      $('#s6-crit').innerHTML = h + '</div>';
    }

    function paintAll() {
      if (!fw) return;
      paintGen(); paintThree(); paintFrame(); paintCrit();
      saveDraft();
    }

    /* ---- 공통 맥락 ---- */
    function context() {
      var kc = (state.keyConcepts || []).map(koOf).join(', ');
      var lines = loi().map(function (l, i) { return (i + 1) + ') ' + l.text; }).join('\n');
      var stds = (state.standards || []).map(function (o) {
        return '- ' + o.code + ' ' + o.text;
      }).join('\n');
      return '[학년] ' + state.grade + '학년\n' +
             '[중심 아이디어] ' + (state.centralIdea || '') + '\n' +
             (kc ? '[주요 개념] ' + kc + '\n' : '') +
             '[탐구 목록]\n' + lines + '\n\n' +
             '[고른 성취기준]\n' + stds + '\n';
    }

    /* ---- 생성 ① 평가 세 가지 + 도달 기준 ---- */
    function buildPrompt() {
      return '당신은 IB PYP 초학문적 탐구 단원을 설계하는 한국 초등학교 교사를 돕는다.\n\n' +
             context() + '\n' +
             '[할 일] 이 단원의 평가를 마련한다.\n' +
             '- 진단평가: 단원을 열 때 학생이 이미 아는 것과 오개념을 살피는 방법. ' +
             '점수를 매기는 시험이 아니라 드러내 보이게 하는 활동으로 쓴다.\n' +
             '- 형성평가: 탐구가 흘러가는 동안 이해가 어디쯤 왔는지 확인하는 방법. ' +
             '탐구 목록의 진행과 맞물리게 쓴다.\n' +
             '- 총괄평가: 중심 아이디어에 이르렀는지를 학생이 드러내 보이는 과제. ' +
             '단순 지식 확인이 아니라 배운 것을 새로운 상황에 써 보게 하는 과제로 쓴다.\n' +
             '- 도달 기준: 지식(무엇을 알게 되는가), 이해(무엇을 이해하게 되는가), ' +
             '기능(무엇을 할 수 있게 되는가)을 각각 한두 문장으로 쓴다. ' +
             '이해는 중심 아이디어와 이어지게 쓴다.\n\n' +
             '공통 조건:\n' +
             '- ' + state.grade + '학년 교실에서 실제로 할 수 있는 방법으로 쓴다.\n' +
             '- 평서형 종결어미(-다)로 끝낸다. 존댓말 어미를 쓰지 않는다.\n' +
             '- 고유명사와 특정 지명·인명을 넣지 않는다.\n\n' +
             '[출력] 다음 형태의 JSON만 출력한다.\n' +
             '{ "diagnostic": "진단평가", "formative": "형성평가", "summative": "총괄평가", ' +
             '"criteria": { "knowledge": "지식", "understanding": "이해", "skills": "기능" } }';
    }

    function generate() {
      if (!state.centralIdea) { msg('#s6-msg', '2단계에서 중심 아이디어를 먼저 써 주세요.', 'warn'); return; }
      var btn = $('#s6-gen [data-act="gen"]');
      if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }
      msg('#s6-msg', '중심 아이디어와 탐구 목록에 맞춰 평가를 짜는 중입니다. 20초쯤 걸립니다.', 'info');

      callGemini(buildPrompt()).then(function (res) {
        var a = A();
        a.diagnostic = String((res && res.diagnostic) || '').trim();
        a.formative = String((res && res.formative) || '').trim();
        a.summative = String((res && res.summative) || '').trim();
        var c = (res && res.criteria) || {};
        a.criteria = {
          knowledge: String(c.knowledge || '').trim(),
          understanding: String(c.understanding || '').trim(),
          skills: String(c.skills || '').trim()
        };
        paintAll();
        msg('#s6-msg', a.summative
          ? '평가와 도달 기준을 만들었습니다. 우리 반 사정에 맞게 고쳐 쓰세요.'
          : '평가를 만들지 못했습니다. 다시 눌러 주세요.', a.summative ? 'info' : 'warn');
      })['catch'](function (e) {
        paintAll();
        msg('#s6-msg', msgOf(e), 'stop');
      });
    }

    /* ---- 생성 ② 고른 틀의 칸 채우기 ---- */
    function buildFramePrompt() {
      var a = A();
      var f = FRAMES[a.frame];
      var slots = f.slots.map(function (sl) {
        return '- ' + sl.id + ' (' + sl.ko + '): ' + sl.hint;
      }).join('\n');

      return '당신은 IB PYP 초학문적 탐구 단원을 설계하는 한국 초등학교 교사를 돕는다.\n\n' +
             context() + '\n' +
             '[지금의 총괄평가] ' + (a.summative || '(아직 없음)') + '\n\n' +
             '[할 일] 위 총괄평가를 ' + f.ko + ' 틀로 펼친다. 아래 칸을 모두 채운다.\n' +
             slots + '\n\n' +
             '조건:\n' +
             '- 지금의 총괄평가에서 벗어나지 않는다. 같은 과제를 틀에 맞춰 또렷하게 하는 것이다.\n' +
             '- ' + state.grade + '학년 학생이 읽고 무엇을 할지 알 수 있는 말로 쓴다.\n' +
             '- 각 칸은 한두 문장으로 짧게 쓴다.\n' +
             '- 고유명사와 실제 기관·인물 이름을 넣지 않는다. 역할과 청중은 일반적인 말로 쓴다.\n\n' +
             '[출력] 다음 형태의 JSON만 출력한다. 위 칸 이름을 그대로 쓴다.\n' +
             '{ ' + f.slots.map(function (sl) { return '"' + sl.id + '": "내용"'; }).join(', ') + ' }';
    }

    function fillFrame() {
      var a = A();
      if (!a.frame) return;
      if (!a.summative) { msg('#s6-fmsg', '먼저 위에서 총괄평가를 써 주세요.', 'warn'); return; }
      var btn = $('#s6-frame [data-act="fill"]');
      if (btn) { btn.disabled = true; btn.textContent = '채우는 중…'; }
      msg('#s6-fmsg', '총괄평가를 틀에 맞춰 펼치는 중입니다. 15초쯤 걸립니다.', 'info');

      callGemini(buildFramePrompt()).then(function (res) {
        var f = FRAMES[a.frame];
        var got = {};
        f.slots.forEach(function (sl) {
          var v = res && res[sl.id];
          if (v) got[sl.id] = String(v).trim();
        });
        a.frameData = got;
        paintAll();
        var n = Object.keys(got).length;
        msg('#s6-fmsg', n
          ? f.ko + ' 칸 ' + n + '개를 채웠습니다. 고쳐 쓰신 뒤 아래 버튼으로 총괄평가에 반영할 수 있습니다.'
          : '칸을 채우지 못했습니다. 다시 눌러 주세요.', n ? 'info' : 'warn');
      })['catch'](function (e) {
        paintAll();
        msg('#s6-fmsg', msgOf(e), 'stop');
      });
    }

    /** 칸 내용을 모아 총괄평가 서술로 옮긴다. 호출 없음. */
    function toSummative() {
      var a = A();
      if (!a.frame) return;
      var f = FRAMES[a.frame];
      var parts = [];
      f.slots.forEach(function (sl) {
        var v = String((a.frameData || {})[sl.id] || '').trim();
        if (v) parts.push(sl.ko + ': ' + v);
      });
      if (!parts.length) { msg('#s6-fmsg', '먼저 칸을 채워 주세요.', 'warn'); return; }
      a.summative = '[' + f.ko + '] ' + parts.join(' / ');
      paintAll();
      msg('#s6-fmsg', '총괄평가 칸에 옮겼습니다. 위에서 다듬어 주세요.', 'info');
    }

    /* ---- 조작 ---- */
    function pickFrame(v) {
      var a = A();
      var next = (v === 'none') ? null : v;
      if (a.frame === next) return;
      // 두 틀은 항목이 달라 내용을 옮길 수 없다. 바꾸면 비운다.
      a.frame = next;
      a.frameData = {};
      paintAll();
    }

    function bindStep6() {
      var root = $('#step-6');
      root.addEventListener('click', function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el || !root.contains(el)) return;
        var act = el.getAttribute('data-act');
        if (act === 'gen') generate();
        if (act === 'frame') pickFrame(el.getAttribute('data-v'));
        if (act === 'fill') fillFrame();
        if (act === 'toSummative') toSummative();
      });
      root.addEventListener('input', function (ev) {
        var t = ev.target;
        if (!t || !t.matches) return;
        var a = A();
        var k = t.getAttribute('data-k');
        if (t.matches('[data-act="asm"]')) { a[k] = t.value; saveDraft(); }
        else if (t.matches('[data-act="crit"]')) { a.criteria[k] = t.value; saveDraft(); }
        else if (t.matches('[data-act="slot"]')) { a.frameData[k] = t.value; saveDraft(); }
      });
    }

    registerGuard(6, function (st) {
      var hard = [], soft = [];
      var a = st.assessment || {};
      var c = a.criteria || {};
      var t = function (v) { return String(v || '').trim(); };

      if (!t(a.summative)) hard.push('총괄평가를 써 주세요. 단원이 어디로 향하는지 정하는 자리입니다.');

      if (!hard.length) {
        var miss = [];
        if (!t(a.diagnostic)) miss.push('진단평가');
        if (!t(a.formative)) miss.push('형성평가');
        if (miss.length) soft.push(miss.join(' · ') + ' 칸이 비어 있습니다.');

        var cm = [];
        if (!t(c.knowledge)) cm.push('지식');
        if (!t(c.understanding)) cm.push('이해');
        if (!t(c.skills)) cm.push('기능');
        if (cm.length) soft.push('도달 기준에서 ' + cm.join(' · ') + ' 칸이 비어 있습니다.');

        if (a.frame) {
          var f = FRAMES[a.frame];
          var empty = f.slots.filter(function (sl) { return !t((a.frameData || {})[sl.id]); });
          if (empty.length === f.slots.length) {
            soft.push(f.ko + ' 틀을 골랐지만 칸이 모두 비어 있습니다.');
          } else if (empty.length) {
            soft.push(f.ko + ' 틀에서 ' + empty.map(function (sl) { return sl.ko; }).join(' · ') + ' 칸이 비어 있습니다.');
          }
        }
      }
      return { hard: hard, soft: soft };
    });

    function init() {
      bindStep6();
      ensure().then(paintAll)['catch'](function () { /* 데이터가 없으면 조용히 넘어간다 */ });
    }

    return { init: init, repaint: paintAll };
  })();

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
    S1.init();
    S2.init();
    S3.init();
    S4.init();
    S5.init();
    S6.init();
    registerPainter(2, S2.repaint);
    registerPainter(3, S3.repaint);
    registerPainter(4, S4.repaint);
    registerPainter(5, S5.repaint);
    registerPainter(6, S6.repaint);
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
