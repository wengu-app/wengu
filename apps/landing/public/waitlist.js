(() => {
  const form = document.getElementById("waitlist-form");
  const status = document.getElementById("form-status");
  if (!form || !status) return;

  const endpoint =
    document.querySelector('meta[name="waitlist-endpoint"]')?.content || "/api/waitlist";
  const input = form.elements.namedItem("email");
  const honeypot = form.elements.namedItem("company");
  const button = form.querySelector("button");
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const show = (text, kind = "") => {
    status.textContent = text;
    status.className = `form-status ${kind}`;
  };

  input.addEventListener("input", () => {
    input.removeAttribute("aria-invalid");
    if (status.classList.contains("err")) show("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = input.value.trim();

    if (!EMAIL_RE.test(email)) {
      input.setAttribute("aria-invalid", "true");
      input.focus();
      show("请填写有效的邮箱地址。", "err");
      return;
    }

    // 机器人填了隐藏字段：假装成功，不提交。
    if (honeypot.value) {
      show("已加入。第一个版本可用时会发邮件给你。", "ok");
      form.reset();
      return;
    }

    button.disabled = true;
    show("提交中…");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(String(res.status));
      show("已加入。第一个版本可用时会发邮件给你。", "ok");
      form.reset();
    } catch {
      show("提交失败，请稍后再试。", "err");
    } finally {
      button.disabled = false;
    }
  });
})();
