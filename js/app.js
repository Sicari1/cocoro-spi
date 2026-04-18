(function () {
  const APP = {
    questions: window.QUESTIONS || [],
    meta: window.QUESTION_META || {},
    theme: null,
    sources: [],
    currentTab: "practice",
    currentPracticeQuestionId: null,
    toastTimer: null,
    escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
    formatCategory(category) {
      return (this.meta.categories && this.meta.categories[category]) || category;
    },
    formatType(type) {
      return (this.meta.types && this.meta.types[type]) || type;
    },
    getQuestionById(id) {
      return this.questions.find((question) => question.id === id) || null;
    },
    shuffleArray(items) {
      const cloned = items.slice();
      for (let i = cloned.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
      }
      return cloned;
    },
    filterQuestions(filters) {
      return this.questions.filter((question) => {
        if (filters.category && filters.category !== "all" && question.category !== filters.category) {
          return false;
        }
        if (filters.type && filters.type !== "all" && question.type !== filters.type) {
          return false;
        }
        if (filters.difficulty && filters.difficulty !== "all" && question.difficulty !== Number(filters.difficulty)) {
          return false;
        }
        if (filters.search) {
          const haystack = [
            question.question,
            question.explanation,
            question.subtype,
            question.typeLabel,
            question.categoryLabel,
            (question.keywords || []).join(" "),
          ].join(" ").toLowerCase();
          if (!haystack.includes(filters.search.toLowerCase())) {
            return false;
          }
        }
        if (filters.unplayedOnly && window.SCORES && window.SCORES.getAttempt(question.id).attempts > 0) {
          return false;
        }
        return true;
      });
    },
    showToast(message) {
      const toast = document.getElementById("toast");
      if (!toast) {
        return;
      }
      toast.textContent = message;
      toast.classList.remove("hidden");
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => {
        toast.classList.add("hidden");
      }, 2400);
    },
    async request(path, options) {
      const response = await fetch(path, {
        headers: {
          "Content-Type": "application/json",
        },
        ...options,
      });
      if (!response.ok) {
        throw new Error(`request_failed:${response.status}`);
      }
      return response.json();
    },
    openModal(options) {
      const overlay = document.getElementById("modal-overlay");
      const title = document.getElementById("modal-title");
      const body = document.getElementById("modal-body");
      const confirm = document.getElementById("modal-confirm-btn");
      const cancel = document.getElementById("modal-cancel-btn");
      if (!overlay || !title || !body || !confirm || !cancel) {
        return;
      }
      title.textContent = options.title || "確認";
      body.innerHTML = options.html || "";
      confirm.textContent = options.confirmText || "閉じる";
      cancel.textContent = options.cancelText || "閉じる";
      overlay.classList.remove("hidden");
      const close = () => {
        overlay.classList.add("hidden");
        confirm.onclick = null;
      };
      confirm.onclick = () => {
        if (typeof options.onConfirm === "function") {
          options.onConfirm();
        }
        close();
      };
      cancel.onclick = close;
      document.getElementById("modal-close-btn").onclick = close;
      overlay.onclick = (event) => {
        if (event.target === overlay) {
          close();
        }
      };
    },
    setTab(tabName) {
      this.currentTab = tabName;
      document.querySelectorAll(".tab-btn").forEach((button) => {
        const active = button.dataset.tab === tabName;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${tabName}`);
      });
      window.dispatchEvent(new CustomEvent("cocoro:tab-changed", { detail: { tab: tabName } }));
    },
    openPracticeQuestion(questionId) {
      this.currentPracticeQuestionId = questionId;
      this.setTab("practice");
      window.dispatchEvent(new CustomEvent("cocoro:open-practice-question", { detail: { questionId } }));
    },
    notifyDataUpdated() {
      window.dispatchEvent(new CustomEvent("cocoro:data-updated"));
    },
    renderTheme() {
      if (!this.theme) {
        return;
      }
      const heroTitle = document.getElementById("hero-title");
      const heroSubtitle = document.getElementById("hero-subtitle");
      const sourceLinks = document.getElementById("official-links");
      if (heroTitle) {
        heroTitle.textContent = this.theme.heroTitle;
      }
      if (heroSubtitle) {
        heroSubtitle.textContent = this.theme.heroSubtitle;
      }
      if (sourceLinks) {
        sourceLinks.innerHTML = (this.theme.officialLinks || []).map((item) => `
          <a class="hero-link" href="${item.url}" target="_blank" rel="noreferrer">${this.escapeHtml(item.title)}</a>
        `).join("");
      }
    },
    async bootstrap() {
      const payload = await this.request("/api/bootstrap");
      this.questions = payload.questions || [];
      this.meta = payload.meta || this.meta;
      this.theme = payload.theme || null;
      this.sources = payload.sources || [];
      window.QUESTIONS = this.questions;
      window.QUESTION_META = this.meta;
      window.__COCORO_BOOTSTRAP__ = payload;
      this.renderTheme();
      this.setTab("practice");
      window.dispatchEvent(new CustomEvent("cocoro:ready", { detail: payload }));
      return payload;
    },
  };

  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => APP.setTab(button.dataset.tab));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    APP.ready = APP.bootstrap().catch((error) => {
      console.error(error);
      APP.showToast("データの読み込みに失敗しました。");
    });
  });

  window.APP = APP;
})();
