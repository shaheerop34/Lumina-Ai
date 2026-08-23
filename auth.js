/* ================================================================
   Lumina AI — Auth UI
   Talks to /api/auth/{register,login,logout,me}. The session itself
   lives in an httpOnly cookie set by the server — this file never
   touches or stores a token directly, it just reacts to whether the
   server says we're logged in.
   ================================================================ */

(function () {
  const overlay      = document.getElementById("authOverlay");
  const authError    = document.getElementById("authError");
  const tabLogin     = document.getElementById("tabLogin");
  const tabRegister  = document.getElementById("tabRegister");
  const loginForm    = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const goRegister   = document.getElementById("goRegister");
  const goLogin      = document.getElementById("goLogin");
  const loginSubmit  = document.getElementById("loginSubmit");
  const registerSubmit = document.getElementById("registerSubmit");
  const accountChip  = document.getElementById("accountChip");
  const accountEmail = document.getElementById("accountEmail");
  const logoutBtn    = document.getElementById("logoutBtn");

  let chatStarted = false;

  function showError(msg) {
    authError.textContent = msg;
    authError.hidden = false;
  }
  function clearError() {
    authError.hidden = true;
    authError.textContent = "";
  }

  function showTab(which) {
    clearError();
    const login = which === "login";
    tabLogin.classList.toggle("active", login);
    tabRegister.classList.toggle("active", !login);
    tabLogin.setAttribute("aria-selected", String(login));
    tabRegister.setAttribute("aria-selected", String(!login));
    loginForm.hidden = !login;
    registerForm.hidden = login;
  }
  tabLogin.onclick = () => showTab("login");
  tabRegister.onclick = () => showTab("register");
  goRegister.onclick = () => showTab("register");
  goLogin.onclick = () => showTab("login");

  function setBusy(btn, busy, label) {
    btn.disabled = busy;
    btn.textContent = busy ? "Please wait…" : label;
  }

  function onAuthenticated(user) {
    overlay.classList.remove("show");
    accountChip.hidden = false;
    accountEmail.textContent = user.displayName ? user.displayName : user.email;
    accountEmail.title = user.email;
    if (!chatStarted && typeof window.startLuminaChat === "function") {
      chatStarted = true;
      window.startLuminaChat(user);
    }
  }

  async function checkSession() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      const data = await res.json();
      if (res.ok && data.user) {
        onAuthenticated(data.user);
        return;
      }
    } catch (err) {
      /* fall through to showing the login form */
    }
    overlay.classList.add("show");
    try {
      if (sessionStorage.getItem("lumina_session_expired")) {
        sessionStorage.removeItem("lumina_session_expired");
        showError("Your session expired — please log in again.");
      }
    } catch (e) {}
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    setBusy(loginSubmit, true, "Log In");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not log in.");
      onAuthenticated(data.user);
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(loginSubmit, false, "Log In");
    }
  });

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    const displayName = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const password = document.getElementById("registerPassword").value;
    const password2 = document.getElementById("registerPassword2").value;

    if (password.length < 8) {
      showError("Password must be at least 8 characters.");
      return;
    }
    if (password !== password2) {
      showError("Passwords don't match.");
      return;
    }

    setBusy(registerSubmit, true, "Create Account");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create account.");
      onAuthenticated(data.user);
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(registerSubmit, false, "Create Account");
    }
  });

  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch (err) {
      /* clear client state regardless */
    }
    // Full reload (not just hiding the UI) so no in-memory chat state from
    // this account can linger if someone else logs in on the same device.
    window.location.reload();
  });

  // Exposed so app.js can react if a chat call comes back 401
  // (e.g. the session expired while the tab was open). We reload rather
  // than just re-showing the overlay so no stale in-memory chat state
  // from the expired session lingers around.
  window.LuminaAuth = {
    forceReauth: () => {
      try { sessionStorage.setItem("lumina_session_expired", "1"); } catch (e) {}
      window.location.reload();
    },
  };

  checkSession();
})();
