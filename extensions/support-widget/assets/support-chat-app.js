/* global globalThis */
(function (root) {
  "use strict";

  /* ───────────── Intent detection (pure, also used by unit tests) ───────────── */

  var REFUND_PATTERNS = [
    /\b(refund|refound|refun)(s|ed|ing)?\b/,
    /\bmoney\s*back\b/,
    /\breimburs/,
    /\bcharge\s*-?\s*backs?\b/,
    /\bdisput(e|ed|ing)\b/,
    /\bcancel+(ed|led)?\s+(my\s+)?(order|purchase|payment)\b/,
    /\breturn\s+(my\s+)?(money|order|purchase|payment)\b/,
    /\b(get|want|need)\s+(my\s+)?money\b/,
    /\brembours/,
    /\breembols/,
    /\bdevoluci[oó]n\b/,
    /r[uü]ckerstattung/,
    /\bgeld\s+zur[uü]ck\b/,
    /\brimbors/,
    /\bterugbetal/,
    /\bzwrot/,
    /\biade\b/,
    /возврат/,
    /退款/,
    /返金/,
    /환불/
  ];

  var INTENTS = [
    { id: "key_not_received", patterns: [
      /\b(not|never|didn'?t|did not|haven'?t|have not|hasn'?t)\s+(yet\s+)?(get|got|receive[d]?|arrive[d]?|come|came)\b/,
      /\b(no|missing|where('?s| is))\s+(my\s+)?(code|key|email|activation|license)\b/,
      /\bnot\s+receiv/
    ] },
    { id: "key_not_working", patterns: [
      /\b(invalid|expired|rejected|wrong\s+(code|key))\b/,
      /(code|key|activation|license).{0,30}(not|n'?t)\s+(work|valid|accepted|activate)/,
      /\b(doesn'?t|does not|isn'?t|is not|won'?t|not)\s+work/,
      /\berror\b/
    ] },
    { id: "connection", patterns: [
      /connect|disconnect|\bslow\b|\bspeed\b|\bservers?\b|no\s+internet|time\s*out|keeps?\s+dropping/
    ] },
    { id: "install", patterns: [
      /\binstall|set\s*up|\bsetup\b|download|how\s+(do|to)\s+(i\s+)?(use|activate|start|enter)|configur|\bactivate\b/
    ] },
    { id: "compatibility", patterns: [
      /compatib|\biphone\b|\bipad\b|\bios\b|android|windows|\bmac\b|macos|linux|router|smart\s*tv|fire\s*(stick|tv)|chromebook|\bdevice\b/
    ] },
    { id: "billing", patterns: [
      /\bcharged\b|\bbilling\b|\bpayment\b|paid\s+twice|double\s+charge|charged\s+twice|\binvoice\b|\breceipt\b|\bsubscription\b/
    ] },
    { id: "human", patterns: [
      /\bhuman\b|\bagent\b|real\s+person|\bsomeone\b|talk\s+to|speak\s+to|support\s+team|\bcontact\b/
    ] },
    { id: "thanks", patterns: [/\bthank|\bthx\b|\bcheers\b/] },
    { id: "greeting", patterns: [/^(hi|hello|hey|hola|good\s+(morning|afternoon|evening))\b/] }
  ];

  function normalize(text) {
    return String(text || "").toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  }

  function detectIntent(text) {
    var t = normalize(text);
    var refund = REFUND_PATTERNS.some(function (re) { return re.test(t); });
    var intent = null;
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].patterns.some(function (re) { return re.test(t); })) {
        intent = INTENTS[i].id;
        break;
      }
    }
    return { refund: refund, intent: intent };
  }

  function buildReply(detected, cfg) {
    var refundAction = { type: "link", label: "Request a Refund", href: cfg.refundUrl, primary: true };
    var ticketAction = function (topic, label) {
      return { type: "ticket", label: label || "Contact support", topic: topic };
    };
    var technical = ["key_not_received", "key_not_working", "connection", "install", "compatibility"];

    if (detected.refund) {
      var text =
        "I'm sorry this hasn't worked out. You can request a refund using our secure refund form. It takes about 2 minutes, " +
        "and every request is reviewed by a member of our team. You'll receive a request ID as soon as you submit it.";
      if (technical.indexOf(detected.intent) !== -1) {
        text += " If you'd also like help getting it working, our support team can troubleshoot with you at the same time.";
      }
      return { text: text, actions: [refundAction, ticketAction("refund", "Message support instead")] };
    }

    switch (detected.intent) {
      case "key_not_received":
        return {
          text:
            "Activation codes are sent by email right after payment and are also shown on your order confirmation page. " +
            "Please check your spam or promotions folder for an email from " + cfg.shopName + ". " +
            "If you still can't find it, send us your order number and we'll look into it.",
          actions: [ticketAction("activation", "Report a missing code"), refundAction]
        };
      case "key_not_working":
        return {
          text:
            "Sorry about that. Please copy the full code without extra spaces and enter it in one of our supported apps — the setup guide shows each step. " +
            "If it still fails, contact support and include a screenshot of the error message so we can check it.",
          actions: [{ type: "link", label: "Open setup guide", href: cfg.howtoUrl }, ticketAction("activation", "Contact support")]
        };
      case "connection":
        return {
          text:
            "Connection problems are often fixed by switching to a different server location, toggling between Wi-Fi and mobile data, or reinstalling the app. " +
            "If it keeps happening, tell us your device, app and what you see, and our team will help.",
          actions: [ticketAction("connectivity", "Get help with connection"), { type: "link", label: "Read the FAQ", href: cfg.faqUrl }]
        };
      case "install":
        return {
          text: "Our setup guide walks you through downloading the app and entering your activation code step by step.",
          actions: [{ type: "link", label: "Open setup guide", href: cfg.howtoUrl }, ticketAction("installation", "Ask a setup question")]
        };
      case "compatibility":
        return {
          text:
            "Supported devices are listed in our FAQ. If you're not sure whether your device or operating system is supported, ask us before or after purchase and we'll confirm.",
          actions: [{ type: "link", label: "Read the FAQ", href: cfg.faqUrl }, ticketAction("compatibility", "Ask about my device")]
        };
      case "billing":
        return {
          text:
            "For billing questions such as a duplicate charge, please send us your order number and the email used at checkout. Never send your card number. " +
            "If you were charged twice or by mistake, you can also request a refund directly.",
          actions: [ticketAction("billing", "Ask a billing question"), refundAction]
        };
      case "human":
        return {
          text:
            "Our support team replies by email" + (cfg.responseTime ? " " + cfg.responseTime : "") + ". " +
            "Leave a message and you'll get a ticket ID right away.",
          actions: [ticketAction("other", "Message the support team")]
        };
      case "thanks":
        return { text: "You're welcome! Is there anything else I can help with?", actions: [] };
      case "greeting":
        return { text: "Hello! What can I help you with today?", actions: [] };
      default:
        return {
          text:
            "I'm an automated assistant, so I may not have the answer to that. You can send your question to our support team and they'll reply by email.",
          actions: [ticketAction("other", "Message the support team"), { type: "link", label: "Read the FAQ", href: cfg.faqUrl }]
        };
    }
  }

  root.VanishedSupportIntents = { detectIntent: detectIntent, buildReply: buildReply, normalize: normalize };

  if (!root.document || typeof root.document.getElementById !== "function") return;

  /* ───────────── Widget ───────────── */

  var doc = root.document;
  var STORAGE_KEY = "vs-chat-v1";

  var TOPICS = [
    ["purchase", "Purchase or order"],
    ["activation", "Activation key"],
    ["installation", "Installation / setup"],
    ["connectivity", "Connection problem"],
    ["compatibility", "Device compatibility"],
    ["billing", "Billing"],
    ["refund", "Refund"],
    ["other", "Something else"]
  ];

  var QUICK_REPLIES = [
    "I didn't receive my activation key",
    "My activation key doesn't work",
    "How do I install the VPN?",
    "I can't connect",
    "Billing question",
    "I want a refund"
  ];

  function safeHref(href) {
    var value = String(href || "");
    return /^(\/(?!\/)|https:\/\/)/.test(value) ? value : "/";
  }

  function el(tag, attrs, children) {
    var node = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var v = attrs[key];
        if (v === null || v === undefined || v === false) return;
        if (key === "text") node.textContent = v;
        else if (key === "className") node.className = v;
        else if (key.indexOf("on") === 0) node.addEventListener(key.slice(2), v);
        else node.setAttribute(key, v === true ? "" : v);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  var ICON_CHAT = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8.4L4 21.5V6a2 2 0 0 1 0-2zm0 2v11.6L7.6 15H20V6H4zm3 3h10v2H7V9zm0-3h10v2H7V6z" transform="translate(0 1)"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"/></svg>';

  function init(mount) {
    var cfg = {
      proxy: mount.getAttribute("data-proxy") || "/apps/support",
      shopName: mount.getAttribute("data-shop-name") || "our store",
      refundUrl: safeHref(mount.getAttribute("data-refund-url") || "/pages/refund-request"),
      faqUrl: safeHref(mount.getAttribute("data-faq-url") || "/pages/faq"),
      howtoUrl: safeHref(mount.getAttribute("data-howto-url") || "/pages/how-to-use"),
      hours: mount.getAttribute("data-hours") || "",
      responseTime: mount.getAttribute("data-response-time") || "",
      greeting: mount.getAttribute("data-greeting") || "Hi! How can we help?",
      customerEmail: mount.getAttribute("data-customer-email") || "",
      customerName: mount.getAttribute("data-customer-name") || ""
    };

    var state = loadState();
    var ticketDraft = null;

    function loadState() {
      try {
        var saved = JSON.parse(root.sessionStorage.getItem(STORAGE_KEY) || "null");
        if (saved && Array.isArray(saved.messages)) return saved;
      } catch (e) { /* storage unavailable */ }
      return { open: false, messages: [] };
    }

    function saveState() {
      try {
        root.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ open: state.open, messages: state.messages.slice(-40) }));
      } catch (e) { /* storage unavailable */ }
    }

    /* Launcher */
    var launcher = el("button", {
      type: "button",
      className: "vs-chat__launcher",
      "aria-controls": "vs-chat-panel",
      "aria-expanded": "false",
      "aria-label": "Open support chat"
    });
    launcher.innerHTML = ICON_CHAT;
    launcher.appendChild(el("span", { className: "vs-chat__launcher-label", text: "Help" }));

    /* Panel */
    var titleId = "vs-chat-title";
    var closeBtn = el("button", { type: "button", className: "vs-chat__icon-btn", "aria-label": "Close support chat" });
    closeBtn.innerHTML = ICON_CLOSE;

    var statusLines = [el("p", { className: "vs-chat__status", text: "Automated assistant · Our team replies by email" + (cfg.responseTime ? ", " + cfg.responseTime : "") })];
    if (cfg.hours) statusLines.push(el("p", { className: "vs-chat__status vs-chat__status--muted", text: "Support hours: " + cfg.hours }));

    var header = el("div", { className: "vs-chat__header" }, [
      el("div", null, [el("h2", { id: titleId, className: "vs-chat__title", text: "Support" })].concat(statusLines)),
      closeBtn
    ]);

    var log = el("div", { className: "vs-chat__log", role: "log", "aria-live": "polite", "aria-relevant": "additions" });
    var quick = el("div", { className: "vs-chat__quick", role: "group", "aria-label": "Common questions" });
    QUICK_REPLIES.forEach(function (q) {
      quick.appendChild(el("button", { type: "button", className: "vs-chat__chip", text: q, onclick: function () { handleUserMessage(q); } }));
    });

    var input = el("textarea", {
      className: "vs-chat__input",
      rows: "1",
      maxlength: "1000",
      placeholder: "Type your question…",
      "aria-label": "Your message"
    });
    var sendBtn = el("button", { type: "submit", className: "vs-chat__send", text: "Send" });
    var composer = el("form", { className: "vs-chat__composer", novalidate: true }, [input, sendBtn]);

    var footer = el("div", { className: "vs-chat__footer" }, [
      el("a", { className: "vs-chat__footer-link", href: cfg.refundUrl, text: "Request a Refund" }),
      el("button", { type: "button", className: "vs-chat__footer-link", text: "Create a support ticket", onclick: function () { openTicketForm("other"); } })
    ]);

    var chatView = el("div", { className: "vs-chat__view" }, [log, quick, composer]);
    var ticketView = el("div", { className: "vs-chat__view vs-chat__ticket", hidden: true });

    var panel = el("div", {
      id: "vs-chat-panel",
      className: "vs-chat__panel",
      role: "dialog",
      "aria-modal": "false",
      "aria-labelledby": titleId,
      hidden: true
    }, [header, chatView, ticketView, footer]);

    var placeholder = mount.querySelector("[data-vs-placeholder]");
    if (placeholder) placeholder.remove();
    mount.appendChild(panel);
    mount.appendChild(launcher);

    /* Rendering */
    function renderMessage(msg) {
      var bubble = el("div", { className: "vs-chat__msg vs-chat__msg--" + msg.from });
      bubble.appendChild(el("span", { className: "vs-sr-only", text: msg.from === "user" ? "You said: " : "Assistant: " }));
      bubble.appendChild(el("p", { text: msg.text }));
      if (msg.actions && msg.actions.length) {
        var row = el("div", { className: "vs-chat__actions" });
        msg.actions.forEach(function (a) {
          var cls = "vs-chat__action" + (a.primary ? " vs-chat__action--primary" : "");
          if (a.type === "link") {
            row.appendChild(el("a", { className: cls, href: safeHref(a.href), text: a.label }));
          } else if (a.type === "ticket") {
            row.appendChild(el("button", { type: "button", className: cls, text: a.label, onclick: function () { openTicketForm(a.topic); } }));
          }
        });
        bubble.appendChild(row);
      }
      log.appendChild(bubble);
    }

    function renderAll() {
      log.textContent = "";
      state.messages.forEach(renderMessage);
      quick.hidden = state.messages.some(function (m) { return m.from === "user"; });
      log.scrollTop = log.scrollHeight;
    }

    function push(msg) {
      state.messages.push(msg);
      saveState();
      renderMessage(msg);
      quick.hidden = state.messages.some(function (m) { return m.from === "user"; });
      log.scrollTop = log.scrollHeight;
    }

    function handleUserMessage(text) {
      var clean = String(text || "").trim().slice(0, 1000);
      if (!clean) return;
      push({ from: "user", text: clean });
      var reply = buildReply(detectIntent(clean), cfg);
      root.setTimeout(function () { push({ from: "bot", text: reply.text, actions: reply.actions }); }, 350);
    }

    /* Ticket form */
    function field(id, label, control, hint) {
      var errorEl = el("p", { className: "vs-field__error", id: id + "-error", hidden: true });
      control.id = id;
      control.setAttribute("aria-describedby", (hint ? id + "-hint " : "") + id + "-error");
      var children = [el("label", { className: "vs-field__label", for: id, text: label }), control];
      if (hint) children.push(el("p", { className: "vs-field__hint", id: id + "-hint", text: hint }));
      children.push(errorEl);
      return { wrap: el("div", { className: "vs-field" }, children), control: control, error: errorEl };
    }

    function transcript() {
      return state.messages.slice(-12).map(function (m) {
        return (m.from === "user" ? "Customer: " : "Assistant: ") + m.text;
      }).join("\n");
    }

    function lastUserText() {
      var users = state.messages.filter(function (m) { return m.from === "user"; });
      return users.length ? users[users.length - 1].text : "";
    }

    function openTicketForm(topic) {
      ticketDraft = { idempotencyKey: uuid(), startedAt: Date.now() };
      ticketView.textContent = "";

      var topicSelect = el("select", { name: "topic", className: "vs-input" });
      TOPICS.forEach(function (t) {
        topicSelect.appendChild(el("option", { value: t[0], text: t[1], selected: t[0] === topic ? true : null }));
      });

      var fEmail = field("vs-t-email", "Email *", el("input", { type: "email", name: "email", className: "vs-input", autocomplete: "email", required: true, value: cfg.customerEmail || null }));
      var fName = field("vs-t-name", "Name (optional)", el("input", { type: "text", name: "name", className: "vs-input", autocomplete: "name", maxlength: "100", value: cfg.customerName || null }));
      var fOrder = field("vs-t-order", "Order number (optional)", el("input", { type: "text", name: "order_number", className: "vs-input", placeholder: "#1001", maxlength: "40", inputmode: "text" }), "Find it in your order confirmation email.");
      var fTopic = field("vs-t-topic", "Topic", topicSelect);
      var msgArea = el("textarea", { name: "message", className: "vs-input", rows: "4", maxlength: "4000", required: true });
      msgArea.value = lastUserText();
      var fMsg = field("vs-t-message", "How can we help? *", msgArea, "Please don't include card numbers or passwords.");

      var honeypot = el("div", { className: "vs-hp", "aria-hidden": "true" }, [
        el("label", { text: "Leave this field empty" }, [el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off" })])
      ]);

      var formError = el("p", { className: "vs-alert vs-alert--error", role: "alert", hidden: true });
      var submit = el("button", { type: "submit", className: "vs-btn vs-btn--primary", text: "Send to support" });
      var back = el("button", { type: "button", className: "vs-btn vs-btn--ghost", text: "Back to chat", onclick: closeTicketForm });

      var fields = { email: fEmail, name: fName, order_number: fOrder, topic: fTopic, message: fMsg };

      var form = el("form", { className: "vs-chat__ticket-form", novalidate: true }, [
        el("h3", { className: "vs-chat__ticket-title", text: "Message our support team" }),
        el("p", { className: "vs-chat__ticket-intro", text: "We reply by email" + (cfg.responseTime ? ", " + cfg.responseTime : "") + ". You'll get a ticket ID right away." }),
        fEmail.wrap, fName.wrap, fOrder.wrap, fTopic.wrap, fMsg.wrap, honeypot, formError,
        el("div", { className: "vs-chat__ticket-actions" }, [back, submit])
      ]);

      function showErrors(errors) {
        Object.keys(fields).forEach(function (k) {
          var f = fields[k];
          var msg = errors && errors[k];
          f.error.hidden = !msg;
          f.error.textContent = msg || "";
          if (msg) f.control.setAttribute("aria-invalid", "true");
          else f.control.removeAttribute("aria-invalid");
        });
        var first = Object.keys(fields).find(function (k) { return errors && errors[k]; });
        if (first) fields[first].control.focus();
      }

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        formError.hidden = true;
        var errors = {};
        var email = fEmail.control.value.trim();
        if (!email) errors.email = "Enter your email so we can reply.";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "Enter a valid email address.";
        if (msgArea.value.trim().length < 10) errors.message = "Please write at least 10 characters.";
        showErrors(errors);
        if (Object.keys(errors).length) return;

        var data = new FormData(form);
        data.set("idempotency_key", ticketDraft.idempotencyKey);
        data.set("started_at", String(ticketDraft.startedAt));
        data.set("transcript", transcript());

        submit.disabled = true;
        submit.textContent = "Sending…";

        root.fetch(cfg.proxy + "/ticket", { method: "POST", body: data, credentials: "same-origin", headers: { Accept: "application/json" } })
          .then(function (res) {
            return res.json().catch(function () { return { ok: false, message: "Unexpected response from the server." }; });
          })
          .then(function (body) {
            if (body && body.ok) {
              closeTicketForm();
              push({
                from: "bot",
                text:
                  "Thanks — your message was sent to our support team. Your ticket ID is " + body.ticketId + ". " +
                  "We'll reply to " + email + (cfg.responseTime ? " " + cfg.responseTime : "") + ". Please check your spam folder too.",
                actions: []
              });
              return;
            }
            showErrors(body && body.fieldErrors);
            formError.textContent = (body && body.message) || "Your message couldn't be sent. Please try again.";
            formError.hidden = false;
          })
          .catch(function () {
            formError.textContent = "We couldn't reach the server. Check your connection and try again.";
            formError.hidden = false;
          })
          .then(function () {
            submit.disabled = false;
            submit.textContent = "Send to support";
          });
      });

      ticketView.appendChild(form);
      chatView.hidden = true;
      ticketView.hidden = false;
      (fEmail.control.value ? msgArea : fEmail.control).focus();
    }

    function closeTicketForm() {
      ticketView.hidden = true;
      ticketView.textContent = "";
      chatView.hidden = false;
      input.focus();
    }

    /* Open / close */
    function setOpen(open) {
      state.open = open;
      saveState();
      panel.hidden = !open;
      launcher.setAttribute("aria-expanded", open ? "true" : "false");
      launcher.setAttribute("aria-label", open ? "Close support chat" : "Open support chat");
      mount.classList.toggle("vs-chat--open", open);
      if (open) {
        if (!state.messages.length) {
          push({ from: "bot", text: cfg.greeting, actions: [] });
        }
        log.scrollTop = log.scrollHeight;
        if (ticketView.hidden) input.focus();
      }
    }

    launcher.addEventListener("click", function () { setOpen(panel.hidden); if (panel.hidden) launcher.focus(); });
    closeBtn.addEventListener("click", function () { setOpen(false); launcher.focus(); });
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { setOpen(false); launcher.focus(); }
    });

    composer.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value;
      input.value = "";
      input.style.height = "";
      handleUserMessage(text);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        composer.requestSubmit ? composer.requestSubmit() : composer.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });
    input.addEventListener("input", function () {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });

    renderAll();
    if (state.open) setOpen(true);

    return { open: function () { setOpen(true); } };
  }

  var controller = null;

  /* Started by support-chat.js (the lightweight loader) on first interaction. */
  root.VanishedSupportChat = {
    start: function (mount, open) {
      if (!controller) controller = init(mount);
      if (open) controller.open();
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
