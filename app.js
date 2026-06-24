const app = document.querySelector("#app");

const STORAGE_KEY = "gabor-care-state-v1";
const DEFAULT_STATE = {
  calibrationPxPerMm: null,
  distanceMm: 400,
  durationSec: 60,
  contrast: 0.18,
  sessions: [],
};

let state = loadState();
let activeCleanup = null;

function loadState() {
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setScreen(markup, cleanup = null) {
  activeCleanup?.();
  activeCleanup = cleanup;
  app.innerHTML = markup;
  window.scrollTo(0, 0);
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function todaySessions() {
  const today = new Date().toDateString();
  return state.sessions.filter((session) => new Date(session.endedAt).toDateString() === today);
}

function streakDays() {
  const days = new Set(state.sessions.map((session) => new Date(session.endedAt).toDateString()));
  let count = 0;
  const cursor = new Date();
  while (days.has(cursor.toDateString())) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function renderHome() {
  const today = todaySessions();
  const latest = state.sessions[0];
  const history = state.sessions.slice(0, 6);
  const calibrated = Boolean(state.calibrationPxPerMm);

  setScreen(`
    <main class="shell">
      <header class="app-header">
        <p class="brand">Gabor Care</p>
        <button class="text-button" id="settings-button">設定</button>
      </header>

      <section class="hero">
        <p class="eyebrow">今日の目のケア</p>
        <h1>${today.length ? "今日は完了しています" : "1分だけ、見え方を整える"}</h1>
        <p class="lede">低コントラストの縞を見分けたあと、遠くを見て目を休めます。</p>
      </section>

      <section class="summary-strip" aria-label="利用状況">
        <div class="summary-item">
          <span class="summary-value">${today.length}</span>
          <span class="summary-label">今日</span>
        </div>
        <div class="summary-item">
          <span class="summary-value">${streakDays()}</span>
          <span class="summary-label">連続日</span>
        </div>
        <div class="summary-item">
          <span class="summary-value">${latest?.fatigueDelta == null ? "−" : signed(latest.fatigueDelta)}</span>
          <span class="summary-label">前回の疲労変化</span>
        </div>
      </section>

      ${calibrated ? "" : `
        <button class="notice mode-card" id="calibration-notice">
          <strong>最初に画面サイズを合わせます</strong><br />
          <span>縞の細かさを適切にするため、約1分の校正が必要です。</span>
        </button>
      `}

      <section class="mode-list section" aria-label="トレーニングモード">
        <button class="mode-card primary" id="standard-mode">
          <h2>標準トレーニング</h2>
          <p>2回の表示のうち、縞が見えた方を選びます。</p>
          <span class="mode-meta"><span>${state.durationSec === 60 ? "1分" : "3分"}</span><span>推奨</span></span>
        </button>
        <button class="mode-card" id="game-mode">
          <h2>絵探しゲーム</h2>
          <p>見本と同じ向き・細かさの縞を探します。</p>
          <span class="mode-meta"><span>${state.durationSec === 60 ? "1分" : "3分"}</span><span>気軽に</span></span>
        </button>
      </section>

      <section class="section">
        <div class="notice">
          裸眼の屈折を治すものではありません。痛み、複視、急なかすみがある日は使用せず、眼科へ相談してください。
        </div>
      </section>

      <section class="section">
        <h2>最近の記録</h2>
        ${history.length ? `
          <div class="history-list">
            ${history.map((session) => `
              <div class="history-row">
                <div>
                  <strong>${session.mode === "standard" ? "標準" : "絵探し"}</strong>
                  <span>${formatDate(session.endedAt)} / 疲労 ${session.fatigueBefore}→${session.fatigueAfter}</span>
                </div>
                <div class="history-score">${session.mode === "standard" ? `${session.accuracy}%` : `${session.correct}問`}</div>
              </div>
            `).join("")}
          </div>
        ` : `<p class="muted">最初の記録はここに表示されます。</p>`}
      </section>
    </main>
  `);

  document.querySelector("#settings-button").addEventListener("click", renderSettings);
  document.querySelector("#standard-mode").addEventListener("click", () => beginMode("standard"));
  document.querySelector("#game-mode").addEventListener("click", () => beginMode("game"));
  document.querySelector("#calibration-notice")?.addEventListener("click", renderCalibration);
}

function signed(value) {
  if (value > 0) return `+${value}`;
  return String(value);
}

function beginMode(mode) {
  if (!state.calibrationPxPerMm) {
    renderCalibration(() => renderFatigue(mode, "before"));
    return;
  }
  renderFatigue(mode, "before");
}

function renderFatigue(mode, phase, sessionDraft = {}) {
  let value = phase === "before" ? 2 : sessionDraft.fatigueBefore;
  const title = phase === "before" ? "始める前の目の疲れ" : "終わった後の目の疲れ";

  setScreen(`
    <main class="shell screen">
      <header class="screen-header">
        <button class="icon-button" id="back-button" aria-label="戻る">‹</button>
        <h2>${title}</h2>
        <span></span>
      </header>
      <section class="fatigue-panel">
        <p class="muted">いまの感覚に最も近い数字を選んでください。</p>
        <output class="fatigue-value" id="fatigue-value">${value}</output>
        <input class="range" id="fatigue-range" type="range" min="0" max="10" step="1" value="${value}" aria-label="目の疲れ 0から10" />
        <div class="range-labels"><span>疲れなし</span><span>かなり強い</span></div>
        <div class="button-stack">
          <button class="primary-button" id="fatigue-next">${phase === "before" ? "トレーニングへ" : "遠くを見て休む"}</button>
        </div>
      </section>
    </main>
  `);

  const range = document.querySelector("#fatigue-range");
  range.addEventListener("input", () => {
    value = Number(range.value);
    document.querySelector("#fatigue-value").textContent = value;
  });
  document.querySelector("#back-button").addEventListener("click", phase === "before" ? renderHome : () => renderResult(sessionDraft));
  document.querySelector("#fatigue-next").addEventListener("click", () => {
    if (phase === "before") {
      const draft = { mode, fatigueBefore: value, startedAt: new Date().toISOString() };
      if (mode === "standard") startStandard(draft);
      else startGame(draft);
    } else {
      renderRest({ ...sessionDraft, fatigueAfter: value, fatigueDelta: value - sessionDraft.fatigueBefore });
    }
  });
}

function renderModeSetup(mode) {
  setScreen(`
    <main class="shell screen">
      <header class="screen-header">
        <button class="icon-button" id="back-button" aria-label="戻る">‹</button>
        <h2>${mode === "standard" ? "標準トレーニング" : "絵探しゲーム"}</h2>
        <span></span>
      </header>
      <section class="setup-panel">
        <h1>${mode === "standard" ? "縞が見えた順番を答える" : "見本と同じ縞を探す"}</h1>
        <p class="lede">${mode === "standard"
          ? "画面から約40cm離れ、2回の表示のうち中央に薄い縞があった方を選びます。"
          : "画面から約40cm離れ、見本と同じ向き・細かさの縞をタップします。"}</p>
        <div class="option-row">
          <button class="option-button ${state.durationSec === 60 ? "selected" : ""}" data-duration="60">1分</button>
          <button class="option-button ${state.durationSec === 180 ? "selected" : ""}" data-duration="180">3分</button>
        </div>
        <div class="notice">眼鏡やコンタクトは使わず、普段と同じ明るさで行ってください。見づらさを我慢する課題ではありません。</div>
        <div class="button-stack">
          <button class="primary-button" id="setup-next">疲労度を記録して開始</button>
        </div>
      </section>
    </main>
  `);

  document.querySelector("#back-button").addEventListener("click", renderHome);
  document.querySelectorAll("[data-duration]").forEach((button) => {
    button.addEventListener("click", () => {
      state.durationSec = Number(button.dataset.duration);
      saveState();
      renderModeSetup(mode);
    });
  });
  document.querySelector("#setup-next").addEventListener("click", () => beginMode(mode));
}

function startStandard(draft) {
  let remaining = state.durationSec;
  let timerId;
  let timeoutIds = [];
  let running = true;
  let awaitingAnswer = false;
  let targetInterval = 1;
  let trials = 0;
  let correct = 0;
  let correctStreak = 0;
  let contrast = state.contrast;
  let trialStart = 0;
  const reactionTimes = [];

  setScreen(`
    <main class="training-shell">
      <header class="training-top">
        <button class="icon-button" id="quit-button" aria-label="終了">×</button>
        <div class="timer" id="timer">${formatTimer(remaining)}</div>
        <div></div>
      </header>
      <section class="trial-stage">
        <canvas id="stimulus-canvas" aria-label="ガボール刺激"></canvas>
        <div class="stage-message" id="stage-message">
          <div><strong>中央を見ます</strong><span>どちらに薄い縞が出たか答えてください</span></div>
        </div>
      </section>
      <footer class="answer-area">
        <div class="prompt" id="prompt">準備ができたら開始</div>
        <div class="choices">
          <button class="choice-button" id="choice-1" disabled>1回目</button>
          <button class="choice-button" id="choice-2" disabled>2回目</button>
        </div>
      </footer>
    </main>
  `, cleanup);

  const canvas = document.querySelector("#stimulus-canvas");
  const message = document.querySelector("#stage-message");
  const prompt = document.querySelector("#prompt");
  const choice1 = document.querySelector("#choice-1");
  const choice2 = document.querySelector("#choice-2");
  const ctx = prepareCanvas(canvas);
  drawNeutral(ctx, canvas);

  const startButton = document.createElement("button");
  startButton.className = "primary-button";
  startButton.textContent = "開始";
  startButton.style.marginTop = "18px";
  message.querySelector("div").append(startButton);
  startButton.addEventListener("click", () => {
    message.hidden = true;
    timerId = window.setInterval(() => {
      remaining -= 1;
      document.querySelector("#timer").textContent = formatTimer(remaining);
      if (remaining <= 0) finish();
    }, 1000);
    runTrial();
  }, { once: true });

  choice1.addEventListener("click", () => answer(1));
  choice2.addEventListener("click", () => answer(2));
  document.querySelector("#quit-button").addEventListener("click", () => {
    cleanup();
    renderHome();
  });

  function runTrial() {
    if (!running) return;
    awaitingAnswer = false;
    choice1.disabled = true;
    choice2.disabled = true;
    targetInterval = Math.random() < 0.5 ? 1 : 2;
    const spatialFrequency = [2, 4, 6][Math.floor(Math.random() * 3)];
    const orientation = [0, 45, 90, 135][Math.floor(Math.random() * 4)];
    const trial = { spatialFrequency, orientation };

    prompt.textContent = "1回目";
    drawFixation(ctx, canvas);
    schedule(() => drawStandardFrame(ctx, canvas, trial, targetInterval === 1, contrast), 350);
    schedule(() => drawMask(ctx, canvas), 530);
    schedule(() => drawFixation(ctx, canvas), 750);
    schedule(() => { prompt.textContent = "2回目"; }, 900);
    schedule(() => drawStandardFrame(ctx, canvas, trial, targetInterval === 2, contrast), 1080);
    schedule(() => drawMask(ctx, canvas), 1260);
    schedule(() => {
      drawFixation(ctx, canvas);
      prompt.textContent = "どちらに見えましたか？";
      awaitingAnswer = true;
      trialStart = performance.now();
      choice1.disabled = false;
      choice2.disabled = false;
    }, 1480);
  }

  function answer(selected) {
    if (!awaitingAnswer || !running) return;
    awaitingAnswer = false;
    trials += 1;
    const isCorrect = selected === targetInterval;
    reactionTimes.push(performance.now() - trialStart);
    if (isCorrect) {
      correct += 1;
      correctStreak += 1;
      if (correctStreak >= 2) {
        contrast = Math.max(0.015, contrast * 0.84);
        correctStreak = 0;
      }
      prompt.textContent = "正解";
    } else {
      contrast = Math.min(0.45, contrast * 1.2);
      correctStreak = 0;
      prompt.textContent = `${targetInterval}回目でした`;
    }
    choice1.disabled = true;
    choice2.disabled = true;
    if (navigator.vibrate) navigator.vibrate(isCorrect ? 20 : [20, 40, 20]);
    schedule(runTrial, 480);
  }

  function finish() {
    if (!running) return;
    cleanup();
    state.contrast = contrast;
    saveState();
    const result = {
      ...draft,
      trials,
      correct,
      accuracy: trials ? Math.round((correct / trials) * 100) : 0,
      finalContrast: Math.round(contrast * 1000) / 10,
      meanReactionMs: reactionTimes.length
        ? Math.round(reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length)
        : null,
      durationSec: state.durationSec,
      endedAt: new Date().toISOString(),
    };
    renderResult(result);
  }

  function schedule(fn, delay) {
    const id = window.setTimeout(fn, delay);
    timeoutIds.push(id);
  }

  function cleanup() {
    running = false;
    window.clearInterval(timerId);
    timeoutIds.forEach(window.clearTimeout);
    timeoutIds = [];
  }
}

function startGame(draft) {
  let remaining = state.durationSec;
  let timerId;
  let running = true;
  let correct = 0;
  let attempts = 0;
  let targetIndex = 0;
  let patches = [];
  let sample = null;

  setScreen(`
    <main class="training-shell game-training-shell">
      <header class="training-top">
        <button class="icon-button" id="quit-button" aria-label="終了">×</button>
        <div class="timer" id="timer">${formatTimer(remaining)}</div>
        <div></div>
      </header>
      <section class="game-instruction">
        <canvas class="sample-canvas" id="sample-canvas" width="128" height="128" aria-label="見本"></canvas>
        <div><strong>同じ縞を探す</strong><br><span class="helper">向きと細かさを見比べます</span></div>
        <div class="game-score"><span id="game-score">0</span><br><span class="helper">正解</span></div>
      </section>
      <section class="game-stage">
        <canvas id="game-canvas" aria-label="ガボールパッチの選択肢"></canvas>
      </section>
    </main>
  `, cleanup);

  const canvas = document.querySelector("#game-canvas");
  const sampleCanvas = document.querySelector("#sample-canvas");
  prepareCanvas(canvas);
  drawRound();

  timerId = window.setInterval(() => {
    remaining -= 1;
    document.querySelector("#timer").textContent = formatTimer(remaining);
    if (remaining <= 0) finish();
  }, 1000);

  canvas.addEventListener("pointerup", onTap);
  document.querySelector("#quit-button").addEventListener("click", () => {
    cleanup();
    renderHome();
  });

  function drawRound() {
    const orientations = [0, 45, 90, 135];
    const frequencies = [2, 4, 6];
    sample = {
      orientation: orientations[Math.floor(Math.random() * orientations.length)],
      spatialFrequency: frequencies[Math.floor(Math.random() * frequencies.length)],
      phase: Math.random() < 0.5 ? 0 : Math.PI,
    };
    targetIndex = Math.floor(Math.random() * 16);
    patches = Array.from({ length: 16 }, (_, index) => {
      if (index === targetIndex) return { ...sample };
      let patch;
      do {
        patch = {
          orientation: orientations[Math.floor(Math.random() * orientations.length)],
          spatialFrequency: frequencies[Math.floor(Math.random() * frequencies.length)],
          phase: Math.random() < 0.5 ? 0 : Math.PI,
        };
      } while (
        patch.orientation === sample.orientation &&
        patch.spatialFrequency === sample.spatialFrequency &&
        patch.phase === sample.phase
      );
      return patch;
    });
    drawSample(sampleCanvas, sample);
    drawGameGrid(canvas, patches);
  }

  function onTap(event) {
    if (!running) return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * 4);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * 4);
    const selected = row * 4 + col;
    attempts += 1;
    if (selected === targetIndex) {
      correct += 1;
      document.querySelector("#game-score").textContent = correct;
      if (navigator.vibrate) navigator.vibrate(20);
      drawRound();
    } else {
      if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      flashWrong(canvas, selected, patches);
    }
  }

  function finish() {
    if (!running) return;
    cleanup();
    renderResult({
      ...draft,
      correct,
      attempts,
      accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
      durationSec: state.durationSec,
      endedAt: new Date().toISOString(),
    });
  }

  function cleanup() {
    running = false;
    window.clearInterval(timerId);
    canvas?.removeEventListener("pointerup", onTap);
  }
}

function renderResult(result) {
  const primary = result.mode === "standard" ? `${result.accuracy}%` : `${result.correct}`;
  const primaryLabel = result.mode === "standard" ? "正答率" : "正解数";

  setScreen(`
    <main class="shell screen">
      <header class="screen-header">
        <button class="icon-button" id="close-button" aria-label="ホームへ">×</button>
        <h2>トレーニング完了</h2>
        <span></span>
      </header>
      <section class="result-panel">
        <p class="muted">${result.mode === "standard" ? "薄い縞を見分ける課題" : "見本と同じ縞を探す課題"}</p>
        <div class="result-number">${primary}</div>
        <p>${primaryLabel}</p>
        <div class="result-grid">
          <div class="result-cell">
            <strong>${result.correct}</strong>
            <span>正解</span>
          </div>
          <div class="result-cell">
            <strong>${result.mode === "standard" ? result.trials : result.attempts}</strong>
            <span>${result.mode === "standard" ? "試行" : "タップ"}</span>
          </div>
          ${result.mode === "standard" ? `
            <div class="result-cell">
              <strong>${result.finalContrast}%</strong>
              <span>最終コントラスト</span>
            </div>
            <div class="result-cell">
              <strong>${result.meanReactionMs ? `${result.meanReactionMs}ms` : "−"}</strong>
              <span>平均反応時間</span>
            </div>
          ` : ""}
        </div>
        <div class="button-stack">
          <button class="primary-button" id="result-next">疲労度を記録</button>
        </div>
      </section>
    </main>
  `);

  document.querySelector("#close-button").addEventListener("click", renderHome);
  document.querySelector("#result-next").addEventListener("click", () => renderFatigue(result.mode, "after", result));
}

function renderRest(result) {
  let remaining = 20;
  let completed = false;
  let timerId;

  setScreen(`
    <main class="shell screen">
      <header class="screen-header">
        <span></span>
        <h2>目の休憩</h2>
        <span></span>
      </header>
      <section class="result-panel">
        <h1>窓の外など、約6m先を見ます</h1>
        <p class="lede">肩の力を抜いて、意識して数回まばたきをしてください。</p>
        <div class="rest-orb">
          <span class="rest-count" id="rest-count">${remaining}</span>
        </div>
        <button class="primary-button" id="finish-button" disabled>20秒後に完了</button>
      </section>
    </main>
  `, cleanup);

  timerId = window.setInterval(() => {
    remaining -= 1;
    document.querySelector("#rest-count").textContent = remaining;
    if (remaining <= 0) {
      window.clearInterval(timerId);
      completed = true;
      const button = document.querySelector("#finish-button");
      button.disabled = false;
      button.textContent = "今日のケアを完了";
    }
  }, 1000);

  document.querySelector("#finish-button").addEventListener("click", () => {
    if (!completed) return;
    cleanup();
    state.sessions.unshift(result);
    state.sessions = state.sessions.slice(0, 90);
    saveState();
    renderHome();
  });

  function cleanup() {
    window.clearInterval(timerId);
  }
}

function renderCalibration(afterSave = renderHome) {
  const onComplete = typeof afterSave === "function" ? afterSave : renderHome;
  let linePx = state.calibrationPxPerMm ? Math.round(state.calibrationPxPerMm * 53.98) : Math.min(300, window.innerWidth - 72);

  setScreen(`
    <main class="shell screen">
      <header class="screen-header">
        <button class="icon-button" id="back-button" aria-label="戻る">‹</button>
        <h2>画面サイズの校正</h2>
        <span></span>
      </header>
      <section class="calibration-panel">
        <h1>カードの短い辺に合わせます</h1>
        <p class="lede">クレジットカードや運転免許証の短い辺（53.98mm）と、緑の線が同じ長さになるよう調整してください。</p>
        <div class="calibration-line-wrap">
          <div class="calibration-line" id="calibration-line" style="width:${linePx}px"></div>
        </div>
        <input class="range" id="calibration-range" type="range" min="160" max="${Math.max(200, window.innerWidth - 54)}" step="1" value="${linePx}" aria-label="校正線の長さ" />
        <p class="helper">現在 ${linePx}px。カードを画面に重ねず、横に並べてください。</p>
        <div class="button-stack">
          <button class="primary-button" id="save-calibration">この長さで保存</button>
        </div>
      </section>
    </main>
  `);

  const range = document.querySelector("#calibration-range");
  range.addEventListener("input", () => {
    linePx = Number(range.value);
    document.querySelector("#calibration-line").style.width = `${linePx}px`;
    document.querySelector(".helper").textContent = `現在 ${linePx}px。カードを画面に重ねず、横に並べてください。`;
  });
  document.querySelector("#back-button").addEventListener("click", renderHome);
  document.querySelector("#save-calibration").addEventListener("click", () => {
    state.calibrationPxPerMm = linePx / 53.98;
    saveState();
    onComplete();
  });
}

function renderSettings() {
  setScreen(`
    <main class="shell screen">
      <header class="screen-header">
        <button class="icon-button" id="back-button" aria-label="戻る">‹</button>
        <h2>設定</h2>
        <span></span>
      </header>
      <section class="settings-list section">
        <button class="mode-card" id="calibration-button">
          <h3>画面サイズの校正</h3>
          <p>${state.calibrationPxPerMm ? "校正済み。端末を変えた場合は再設定してください。" : "未設定です。"}</p>
        </button>
        <div class="settings-row">
          <h3>標準の時間</h3>
          <div class="option-row">
            <button class="option-button ${state.durationSec === 60 ? "selected" : ""}" data-duration="60">1分</button>
            <button class="option-button ${state.durationSec === 180 ? "selected" : ""}" data-duration="180">3分</button>
          </div>
        </div>
        <div class="settings-row">
          <h3>このアプリについて</h3>
          <p>ガボール刺激による知覚学習と、短時間の遠方休憩を支援する個人用ツールです。医療機器や視力検査ではありません。</p>
        </div>
        <button class="mode-card danger-button" id="clear-button">
          <h3>記録を消去</h3>
          <p>この端末に保存された履歴と難易度を削除します。</p>
        </button>
      </section>
    </main>
  `);

  document.querySelector("#back-button").addEventListener("click", renderHome);
  document.querySelector("#calibration-button").addEventListener("click", renderCalibration);
  document.querySelectorAll("[data-duration]").forEach((button) => {
    button.addEventListener("click", () => {
      state.durationSec = Number(button.dataset.duration);
      saveState();
      renderSettings();
    });
  });
  document.querySelector("#clear-button").addEventListener("click", () => {
    if (window.confirm("記録と設定をすべて消去しますか？")) {
      state = { ...DEFAULT_STATE, sessions: [] };
      saveState();
      renderHome();
    }
  });
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function canvasCssSize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  return { width: canvas.width / dpr, height: canvas.height / dpr };
}

function drawNeutral(ctx, canvas) {
  const { width, height } = canvasCssSize(canvas);
  ctx.fillStyle = "rgb(136,139,136)";
  ctx.fillRect(0, 0, width, height);
}

function drawFixation(ctx, canvas) {
  drawNeutral(ctx, canvas);
  const { width, height } = canvasCssSize(canvas);
  ctx.strokeStyle = "rgba(30,36,31,.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 6, height / 2);
  ctx.lineTo(width / 2 + 6, height / 2);
  ctx.moveTo(width / 2, height / 2 - 6);
  ctx.lineTo(width / 2, height / 2 + 6);
  ctx.stroke();
}

function drawStandardFrame(ctx, canvas, trial, hasTarget, contrast) {
  drawNeutral(ctx, canvas);
  const { width, height } = canvasCssSize(canvas);
  const pxPerMm = state.calibrationPxPerMm || 5;
  const periodPx = periodPixels(trial.spatialFrequency, pxPerMm, state.distanceMm);
  const sigma = Math.max(10, periodPx * 1.1);
  const centerX = width / 2;
  const centerY = height / 2;
  const flankDistance = sigma * 3.1;

  drawGabor(ctx, centerX, centerY - flankDistance, {
    ...trial,
    periodPx,
    sigma,
    contrast: 0.55,
  });
  drawGabor(ctx, centerX, centerY + flankDistance, {
    ...trial,
    periodPx,
    sigma,
    contrast: 0.55,
  });
  if (hasTarget) {
    drawGabor(ctx, centerX, centerY, {
      ...trial,
      periodPx,
      sigma,
      contrast,
    });
  }
}

function periodPixels(cyclesPerDegree, pxPerMm, distanceMm) {
  const degreePerCycle = 1 / cyclesPerDegree;
  const periodMm = 2 * distanceMm * Math.tan((degreePerCycle * Math.PI / 180) / 2);
  return periodMm * pxPerMm;
}

function drawGabor(ctx, cx, cy, options) {
  const {
    periodPx,
    sigma,
    orientation,
    contrast = 0.5,
    phase = 0,
  } = options;
  const scale = ctx.getTransform().a || 1;
  const devicePeriodPx = periodPx * scale;
  const deviceSigma = sigma * scale;
  const deviceCx = cx * scale;
  const deviceCy = cy * scale;
  const radius = Math.ceil(deviceSigma * 3);
  const size = radius * 2 + 1;
  const image = ctx.createImageData(size, size);
  const theta = orientation * Math.PI / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const background = 136;

  for (let py = -radius; py <= radius; py += 1) {
    for (let px = -radius; px <= radius; px += 1) {
      const rotatedX = px * cos + py * sin;
      const envelope = Math.exp(-(px * px + py * py) / (2 * deviceSigma * deviceSigma));
      const carrier = Math.cos((2 * Math.PI * rotatedX) / devicePeriodPx + phase);
      const luminance = Math.max(0, Math.min(255, background + background * contrast * envelope * carrier));
      const index = ((py + radius) * size + (px + radius)) * 4;
      image.data[index] = luminance;
      image.data[index + 1] = luminance;
      image.data[index + 2] = luminance;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, Math.round(deviceCx - radius), Math.round(deviceCy - radius));
}

function drawMask(ctx, canvas) {
  const { width, height } = canvasCssSize(canvas);
  const block = 5;
  for (let y = 0; y < height; y += block) {
    for (let x = 0; x < width; x += block) {
      const value = 108 + Math.floor(Math.random() * 58);
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      ctx.fillRect(x, y, block, block);
    }
  }
}

function drawSample(canvas, patch) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const size = canvas.width;
  ctx.fillStyle = "rgb(136,139,136)";
  ctx.fillRect(0, 0, size, size);
  const pxPerMm = (state.calibrationPxPerMm || 5) * (window.devicePixelRatio || 1);
  const periodPx = periodPixels(patch.spatialFrequency, pxPerMm, state.distanceMm);
  drawGabor(ctx, size / 2, size / 2, {
    ...patch,
    periodPx,
    sigma: size / 7,
    contrast: 0.72,
  });
}

function drawGameGrid(canvas, patches, wrongIndex = null) {
  const ctx = prepareCanvas(canvas);
  const { width, height } = canvasCssSize(canvas);
  ctx.fillStyle = "rgb(136,139,136)";
  ctx.fillRect(0, 0, width, height);
  const cellW = width / 4;
  const cellH = height / 4;
  const patchRadius = Math.min(cellW, cellH) * 0.28;
  const pxPerMm = state.calibrationPxPerMm || 5;

  patches.forEach((patch, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const periodPx = periodPixels(patch.spatialFrequency, pxPerMm, state.distanceMm);
    drawGabor(ctx, col * cellW + cellW / 2, row * cellH + cellH / 2, {
      ...patch,
      periodPx: Math.max(4, periodPx),
      sigma: patchRadius / 2.6,
      contrast: 0.72,
    });
    if (index === wrongIndex) {
      ctx.strokeStyle = "#8c4b47";
      ctx.lineWidth = 3;
      ctx.strokeRect(col * cellW + 6, row * cellH + 6, cellW - 12, cellH - 12);
    }
  });
}

function flashWrong(canvas, selected, patches) {
  drawGameGrid(canvas, patches, selected);
  window.setTimeout(() => drawGameGrid(canvas, patches), 220);
}

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

window.addEventListener("hashchange", () => {
  if (location.hash === "#standard") renderModeSetup("standard");
  else if (location.hash === "#game") renderModeSetup("game");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

renderHome();
