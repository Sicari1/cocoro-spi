(function () {
  const state = {
    category: "all",
    type: "all",
    difficulty: "all",
    search: "",
    unplayedOnly: false,
    selectedQuestionId: null,
  };

  function getList() {
    return window.APP.filterQuestions({
      category: state.category,
      type: state.type,
      difficulty: state.difficulty,
      search: state.search,
      unplayedOnly: state.unplayedOnly,
    });
  }

  function renderStats() {
    const summary = window.SCORES.getSummary();
    document.getElementById("db-total-count").textContent = String(window.APP.questions.length);
    document.getElementById("db-practiced-count").textContent = String(Object.keys(summary.attempts).length);
    const average = summary.totalAttempts ? Math.round((summary.totalCorrect / summary.totalAttempts) * 100) : 0;
    document.getElementById("db-avg-accuracy").textContent = `${average}%`;
  }

  function renderDetail(questionId) {
    const question = window.APP.getQuestionById(questionId);
    if (!question) {
      return;
    }
    state.selectedQuestionId = questionId;
    const attempt = window.SCORES.getAttempt(question.id);
    const accuracy = attempt.attempts ? Math.round((attempt.correct / attempt.attempts) * 100) : 0;
    document.getElementById("db-detail-content").innerHTML = `
      <div class="question-meta">
        <span class="meta-pill">${question.categoryLabel}</span>
        <span class="meta-pill accent">${question.subtype || question.typeLabel}</span>
        <span class="meta-pill lavender">${question.difficultyLabel}</span>
      </div>
      <p class="question-text">${window.APP.escapeHtml(question.question).replace(/\n/g, "<br>")}</p>
      <div class="choices">
        ${question.choices.map((choice, index) => `
          <div class="choice-btn ${index === question.answer ? "correct" : "disabled"}">
            <span class="choice-label">${String.fromCharCode(65 + index)}</span>
            <span>${window.APP.escapeHtml(choice)}</span>
          </div>
        `).join("")}
      </div>
      <div class="tips-box">
        <span class="tips-icon">💡</span>
        <div class="tips-content">${window.APP.escapeHtml(question.explanation)}</div>
      </div>
      <div class="source-card">
        <div class="source-title">出題形式参考</div>
        <a href="${question.sourceUrl}" target="_blank" rel="noreferrer">${window.APP.escapeHtml(question.sourceTitle)}</a>
        <p class="text-muted">${window.APP.escapeHtml(question.sourceNote)}</p>
      </div>
      <div class="stat-row">
        <span class="stat-name">挑戦回数</span>
        <span class="stat-val">${attempt.attempts}回</span>
      </div>
      <div class="stat-row">
        <span class="stat-name">正解率</span>
        <span class="stat-val">${accuracy}%</span>
      </div>
      <button class="btn btn-primary mt-16" id="db-practice-btn">この問題を練習する</button>
    `;
    document.getElementById("db-detail").classList.add("visible");
    document.getElementById("db-practice-btn").addEventListener("click", () => window.APP.openPracticeQuestion(questionId));
  }

  function renderList() {
    renderStats();
    const list = getList();
    const container = document.getElementById("db-list");
    if (!list.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">条件に合う問題がありません</div></div>';
      document.getElementById("db-detail-content").innerHTML = '<div class="empty-state"><div class="empty-icon">🔎</div><div class="empty-text">問題を選ぶと詳細が表示されます</div></div>';
      return;
    }
    container.innerHTML = list.map((question) => {
      const attempt = window.SCORES.getAttempt(question.id);
      const accuracy = attempt.attempts ? Math.round((attempt.correct / attempt.attempts) * 100) : 0;
      const selected = question.id === state.selectedQuestionId;
      return `
        <button class="question-list-item ${selected ? "selected" : ""}" data-question-id="${question.id}">
          <div class="question-list-main">
            <div class="question-meta">
              <span class="meta-pill">${question.categoryLabel}</span>
              <span class="meta-pill accent">${question.subtype || question.typeLabel}</span>
              <span class="meta-pill lavender">${question.difficultyLabel}</span>
            </div>
            <div class="question-text-sm">${window.APP.escapeHtml(question.question).slice(0, 86)}...</div>
          </div>
          <div class="question-list-side">
            <div class="stat-label">${question.id}</div>
            <div class="stat-value">${accuracy}%</div>
          </div>
        </button>
      `;
    }).join("");
    container.querySelectorAll("[data-question-id]").forEach((button) => {
      button.addEventListener("click", () => {
        renderDetail(button.dataset.questionId);
        renderList();
      });
    });
    renderDetail(state.selectedQuestionId || list[0].id);
  }

  function syncButtons() {
    document.querySelectorAll("#db-filter-bar [data-db-category]").forEach((button) => {
      button.classList.toggle("active", button.dataset.dbCategory === state.category);
    });
    document.querySelectorAll("#db-filter-bar [data-db-difficulty]").forEach((button) => {
      button.classList.toggle("active", button.dataset.dbDifficulty === state.difficulty);
    });
    document.getElementById("db-type-select").value = state.type;
    document.getElementById("db-unplayed-only").checked = state.unplayedOnly;
  }

  function registerEvents() {
    document.querySelectorAll("#db-filter-bar [data-db-category]").forEach((button) => {
      button.addEventListener("click", () => {
        state.category = button.dataset.dbCategory;
        syncButtons();
        renderList();
      });
    });
    document.querySelectorAll("#db-filter-bar [data-db-difficulty]").forEach((button) => {
      button.addEventListener("click", () => {
        state.difficulty = button.dataset.dbDifficulty;
        syncButtons();
        renderList();
      });
    });
    document.getElementById("db-type-select").addEventListener("change", (event) => {
      state.type = event.target.value;
      renderList();
    });
    document.getElementById("db-unplayed-only").addEventListener("change", (event) => {
      state.unplayedOnly = event.target.checked;
      renderList();
    });
    document.getElementById("db-search").addEventListener("input", (event) => {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => {
        state.search = event.target.value.trim();
        renderList();
      }, 250);
    });
  }

  document.addEventListener("DOMContentLoaded", registerEvents);
  window.addEventListener("cocoro:ready", () => {
    syncButtons();
    renderList();
  });
  window.addEventListener("cocoro:data-updated", renderList);
  window.addEventListener("cocoro:tab-changed", (event) => {
    if (event.detail.tab === "database") {
      renderList();
    }
  });
})();
