(function () {
  const state = {
    category: "all",
    count: 10,
    timer: "none",
    questionIds: [],
    answers: {},
    currentIndex: 0,
    secondsLeft: 0,
    timerHandle: null,
    latestConfig: null,
  };

  function switchView(viewId) {
    document.querySelectorAll(".exam-view").forEach((view) => {
      view.classList.toggle("active", view.id === viewId);
    });
  }

  function setupButtons() {
    document.querySelectorAll("[data-exam-category]").forEach((card) => {
      card.classList.toggle("selected", card.dataset.examCategory === state.category);
    });
    document.querySelectorAll("#exam-count-btns .count-btn").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.count) === state.count);
    });
    document.querySelectorAll("[data-timer]").forEach((button) => {
      button.classList.toggle("active", button.dataset.timer === state.timer);
    });
  }

  function getPool() {
    const filtered = window.APP.filterQuestions({
      category: state.category,
      type: "all",
      difficulty: "all",
    });
    return window.APP.shuffleArray(filtered).slice(0, Math.min(state.count, filtered.length));
  }

  function totalTimerSeconds() {
    if (state.timer === "none") {
      return 0;
    }
    const numeric = Number(state.timer);
    if (numeric === 30 || numeric === 60) {
      return numeric * state.count;
    }
    return numeric;
  }

  function updateTimer() {
    const display = document.getElementById("exam-timer-display");
    if (!display) {
      return;
    }
    const total = totalTimerSeconds();
    if (!total) {
      display.textContent = "∞";
      display.classList.remove("warning", "danger");
      return;
    }
    const minutes = String(Math.floor(state.secondsLeft / 60)).padStart(2, "0");
    const seconds = String(state.secondsLeft % 60).padStart(2, "0");
    display.textContent = `${minutes}:${seconds}`;
    const ratio = state.secondsLeft / total;
    display.classList.toggle("warning", ratio <= 0.3 && ratio > 0.15);
    display.classList.toggle("danger", ratio <= 0.15);
  }

  function stopTimer() {
    window.clearInterval(state.timerHandle);
    state.timerHandle = null;
  }

  function startTimer() {
    stopTimer();
    state.secondsLeft = totalTimerSeconds();
    updateTimer();
    if (!state.secondsLeft) {
      return;
    }
    state.timerHandle = window.setInterval(() => {
      state.secondsLeft -= 1;
      updateTimer();
      if (state.secondsLeft <= 0) {
        stopTimer();
        finishExam();
      }
    }, 1000);
  }

  function renderDots() {
    const container = document.getElementById("exam-progress-dots");
    container.innerHTML = state.questionIds.map((questionId, index) => {
      const answer = state.answers[questionId];
      const classes = [
        "progress-dot",
        index === state.currentIndex ? "current" : "",
        answer ? (answer.isCorrect ? "answered-correct" : "answered-wrong") : "",
      ].filter(Boolean).join(" ");
      return `<button class="${classes}" data-progress-index="${index}" aria-label="問題 ${index + 1}"></button>`;
    }).join("");
    container.querySelectorAll("[data-progress-index]").forEach((button) => {
      button.addEventListener("click", () => {
        state.currentIndex = Number(button.dataset.progressIndex);
        renderQuestion();
      });
    });
  }

  function answer(question, selectedIndex) {
    if (state.answers[question.id]) {
      return;
    }
    const isCorrect = selectedIndex === question.answer;
    state.answers[question.id] = { selectedIndex, isCorrect };
    window.SCORES.recordAttempt(question, selectedIndex, isCorrect);
    window.APP.notifyDataUpdated();
    renderQuestion();
  }

  function renderQuestion() {
    const question = window.APP.getQuestionById(state.questionIds[state.currentIndex]);
    if (!question) {
      return;
    }
    const answerData = state.answers[question.id];
    document.getElementById("exam-question-card").innerHTML = `
      <div class="question-meta">
        <span class="meta-pill">${question.categoryLabel}</span>
        <span class="meta-pill accent">${question.subtype || question.typeLabel}</span>
        <span class="meta-pill lavender">${question.difficultyLabel}</span>
      </div>
      <div class="question-number">${question.id}</div>
      <div class="question-text">${window.APP.escapeHtml(question.question).replace(/\n/g, "<br>")}</div>
      <div class="choices">
        ${question.choices.map((choice, index) => {
          const classes = [
            "choice-btn",
            answerData ? "disabled" : "",
            answerData && index === question.answer ? "correct" : "",
            answerData && index === answerData.selectedIndex && !answerData.isCorrect ? "wrong" : "",
          ].filter(Boolean).join(" ");
          return `
            <button class="${classes}" data-exam-choice="${index}">
              <span class="choice-label">${String.fromCharCode(65 + index)}</span>
              <span>${window.APP.escapeHtml(choice)}</span>
            </button>
          `;
        }).join("")}
      </div>
      <div class="source-line">形式参考: <a href="${question.sourceUrl}" target="_blank" rel="noreferrer">${window.APP.escapeHtml(question.sourceTitle)}</a></div>
    `;
    document.getElementById("exam-counter").textContent = `問題 ${state.currentIndex + 1} / ${state.questionIds.length}`;
    const explanation = document.getElementById("exam-explanation");
    if (answerData) {
      explanation.classList.add("visible");
      document.getElementById("exam-explanation-text").textContent = question.explanation;
    } else {
      explanation.classList.remove("visible");
    }
    document.querySelectorAll("[data-exam-choice]").forEach((button) => {
      button.addEventListener("click", () => answer(question, Number(button.dataset.examChoice)));
    });
    renderDots();
  }

  function breakdown() {
    const groups = {
      verbal: { label: "言語", total: 0, score: 0 },
      nonverbal: { label: "非言語", total: 0, score: 0 },
      english: { label: "英語", total: 0, score: 0 },
    };
    state.questionIds.forEach((questionId) => {
      const question = window.APP.getQuestionById(questionId);
      if (!question) {
        return;
      }
      groups[question.category].total += 1;
      if (state.answers[questionId] && state.answers[questionId].isCorrect) {
        groups[question.category].score += 1;
      }
    });
    return Object.values(groups).filter((item) => item.total > 0);
  }

  function finishExam() {
    stopTimer();
    const total = state.questionIds.length;
    const score = state.questionIds.filter((questionId) => state.answers[questionId] && state.answers[questionId].isCorrect).length;
    const percent = total ? Math.round((score / total) * 100) : 0;
    const resultBreakdown = breakdown();
    const examRecord = {
      date: new Date().toISOString(),
      category: state.category,
      score,
      total,
      percent,
      timeUsed: totalTimerSeconds() ? totalTimerSeconds() - state.secondsLeft : null,
      breakdown: resultBreakdown,
      questionIds: state.questionIds,
    };
    window.SCORES.recordExam(examRecord);
    window.APP.notifyDataUpdated();
    switchView("exam-results");
    document.getElementById("exam-score-number").textContent = `${score}/${total}`;
    document.getElementById("exam-score-pct").textContent = `${percent}%`;
    document.getElementById("exam-score-circle").style.setProperty("--score-pct", `${percent}%`);
    document.getElementById("exam-score-circle").classList.toggle("celebrate", percent >= 80);
    document.getElementById("exam-result-message").textContent = percent >= 80 ? "本番ラインを意識できる良い結果です。" : "落とした型を確認して、次は7割超を狙いましょう。";
    document.getElementById("exam-breakdown-body").innerHTML = resultBreakdown.map((item) => `
      <tr>
        <td>${item.label}</td>
        <td>${item.score}</td>
        <td>${item.total}</td>
        <td>${Math.round((item.score / item.total) * 100)}%</td>
      </tr>
    `).join("");
  }

  function startExam() {
    const pool = getPool();
    state.questionIds = pool.map((question) => question.id);
    state.answers = {};
    state.currentIndex = 0;
    state.latestConfig = { category: state.category, count: state.count, timer: state.timer };
    switchView("exam-running");
    renderQuestion();
    startTimer();
  }

  function reviewWrongAnswers() {
    const wrongItems = state.questionIds
      .map((questionId) => ({ question: window.APP.getQuestionById(questionId), answer: state.answers[questionId] }))
      .filter((item) => item.question && (!item.answer || !item.answer.isCorrect));
    if (!wrongItems.length) {
      window.APP.openModal({ title: "答え合わせ", html: "<p>今回は全問正解です。</p>", confirmText: "閉じる" });
      return;
    }
    const html = wrongItems.map((item) => `
      <div class="card">
        <div class="card-title"><span>📌</span>${item.question.id}</div>
        <p>${window.APP.escapeHtml(item.question.question)}</p>
        <p class="text-muted">正解: ${String.fromCharCode(65 + item.question.answer)}. ${window.APP.escapeHtml(item.question.choices[item.question.answer])}</p>
        <p class="text-muted">${window.APP.escapeHtml(item.question.explanation)}</p>
        <p class="text-muted">参考: <a href="${item.question.sourceUrl}" target="_blank" rel="noreferrer">${window.APP.escapeHtml(item.question.sourceTitle)}</a></p>
      </div>
    `).join("");
    window.APP.openModal({ title: "答え合わせ", html, confirmText: "閉じる" });
  }

  function registerEvents() {
    document.querySelectorAll("[data-exam-category]").forEach((card) => {
      card.addEventListener("click", () => {
        state.category = card.dataset.examCategory;
        setupButtons();
      });
    });
    document.querySelectorAll("#exam-count-btns .count-btn").forEach((button) => {
      button.addEventListener("click", () => {
        state.count = Number(button.dataset.count);
        setupButtons();
      });
    });
    document.querySelectorAll("[data-timer]").forEach((button) => {
      button.addEventListener("click", () => {
        state.timer = button.dataset.timer;
        setupButtons();
      });
    });
    document.getElementById("exam-start-btn").addEventListener("click", startExam);
    document.getElementById("exam-prev-btn").addEventListener("click", () => {
      state.currentIndex = Math.max(0, state.currentIndex - 1);
      renderQuestion();
    });
    document.getElementById("exam-next-btn").addEventListener("click", () => {
      if (state.currentIndex >= state.questionIds.length - 1) {
        finishExam();
      } else {
        state.currentIndex += 1;
        renderQuestion();
      }
    });
    document.getElementById("exam-abort-btn").addEventListener("click", finishExam);
    document.getElementById("exam-review-btn").addEventListener("click", reviewWrongAnswers);
    document.getElementById("exam-retry-btn").addEventListener("click", () => {
      if (state.latestConfig) {
        state.category = state.latestConfig.category;
        state.count = state.latestConfig.count;
        state.timer = state.latestConfig.timer;
      }
      setupButtons();
      startExam();
    });
    document.getElementById("exam-tosetup-btn").addEventListener("click", () => {
      stopTimer();
      switchView("exam-setup");
    });
  }

  document.addEventListener("DOMContentLoaded", registerEvents);
  window.addEventListener("cocoro:ready", () => {
    setupButtons();
    switchView("exam-setup");
  });
})();
