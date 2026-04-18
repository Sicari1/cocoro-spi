(function () {
  const state = {
    notices: [],
    messages: [],
  };

  function renderNotices() {
    const track = document.getElementById("notice-track");
    if (!track) {
      return;
    }
    if (!state.notices.length) {
      track.textContent = "Cinnamoroll & SPI tips loading…";
      return;
    }
    const repeated = state.notices.concat(state.notices);
    track.innerHTML = repeated.map((item) => `<span class="notice-item">${window.APP.escapeHtml(item)}</span>`).join("");
  }

  function formatTime(iso) {
    if (!iso) {
      return "";
    }
    return iso.replace("T", " ").replace("Z", "");
  }

  function renderMessages() {
    const stream = document.getElementById("message-stream");
    if (!stream) {
      return;
    }
    if (!state.messages.length) {
      stream.innerHTML = '<div class="empty-state"><div class="empty-icon">☁️</div><div class="empty-text">まだメッセージがありません</div></div>';
      return;
    }
    stream.innerHTML = state.messages.map((item) => `
      <article class="message-bubble">
        <div class="message-meta">
          <span class="message-author">${window.APP.escapeHtml(item.author || "Anonymous")}</span>
          <span class="message-time">${window.APP.escapeHtml(formatTime(item.createdAt))}</span>
        </div>
        <p class="message-body">${window.APP.escapeHtml(item.message)}</p>
      </article>
    `).join("");
  }

  async function submitMessage(event) {
    event.preventDefault();
    const name = document.getElementById("message-name");
    const text = document.getElementById("message-text");
    const status = document.getElementById("message-status");
    const author = name.value.trim();
    const message = text.value.trim();
    if (!message) {
      status.textContent = "メッセージを入力してください";
      return;
    }
    status.textContent = "送信中…";
    try {
      const payload = await window.APP.request("/api/messages", {
        method: "POST",
        body: JSON.stringify({ author, message }),
      });
      state.messages = payload.messages || state.messages;
      renderMessages();
      text.value = "";
      status.textContent = "送信しました";
      window.APP.showToast("メッセージを置きました");
    } catch (error) {
      console.error(error);
      status.textContent = "送信に失敗しました";
    }
  }

  function bindForm() {
    const form = document.getElementById("message-form");
    const input = document.getElementById("message-text");
    const status = document.getElementById("message-status");
    if (!form || !input) {
      return;
    }
    form.addEventListener("submit", submitMessage);
    input.addEventListener("input", () => {
      status.textContent = `${220 - input.value.length}文字のこり`;
    });
  }

  window.addEventListener("cocoro:ready", (event) => {
    state.notices = event.detail.notices || [];
    state.messages = event.detail.messages || [];
    renderNotices();
    renderMessages();
    bindForm();
  });
})();
