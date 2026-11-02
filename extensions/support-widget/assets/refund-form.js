(function () {
  "use strict";

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function init(root) {
    var form = root.querySelector("[data-vs-refund-form]");
    if (!form) return;
    var proxy = root.getAttribute("data-proxy") || "/apps/support";
    var formWrap = root.querySelector("[data-vs-refund-form-wrap]");
    var success = root.querySelector("[data-vs-success]");
    var summary = root.querySelector("[data-vs-error-summary]");
    var submitBtn = root.querySelector("[data-vs-submit]");
    var unverified = root.querySelector("[data-vs-unverified]");
    var allowUnverified = root.querySelector("[data-vs-allow-unverified]");
    var orderPick = root.querySelector("[data-vs-order-pick]");
    var submitting = false;

    form.querySelector("[data-vs-started]").value = String(Date.now());
    form.querySelector("[data-vs-idem]").value = uuid();

    if (orderPick) {
      orderPick.addEventListener("change", function () {
        var opt = orderPick.options[orderPick.selectedIndex];
        var orderInput = form.elements.order_number;
        if (!opt || !opt.value) return;
        if (opt.value === "__manual") {
          orderInput.value = "";
          orderInput.focus();
          return;
        }
        orderInput.value = opt.value;
        var product = opt.getAttribute("data-product");
        if (product && !form.elements.product_name.value) form.elements.product_name.value = product;
      });
    }

    function setFieldError(name, message) {
      var errorEl = form.querySelector('[data-error-for="' + name + '"]');
      var control = form.elements[name];
      if (errorEl) {
        errorEl.textContent = message || "";
        errorEl.hidden = !message;
      }
      if (control && control.setAttribute) {
        if (message) control.setAttribute("aria-invalid", "true");
        else control.removeAttribute("aria-invalid");
      }
    }

    function clearErrors() {
      Array.prototype.forEach.call(form.querySelectorAll("[data-error-for]"), function (node) {
        setFieldError(node.getAttribute("data-error-for"), "");
      });
      summary.hidden = true;
      summary.textContent = "";
    }

    function showErrors(errors, message) {
      var names = Object.keys(errors || {});
      names.forEach(function (n) { setFieldError(n, errors[n]); });
      summary.textContent = message || (names.length === 1 ? "Please fix the highlighted field." : "Please fix the " + names.length + " highlighted fields.");
      summary.hidden = false;
      var first = names.length && form.elements[names[0]];
      if (first && first.focus) first.focus();
      else summary.focus();
    }

    function validate() {
      var errors = {};
      var order = form.elements.order_number.value.trim().replace(/^#+/, "");
      if (!order) errors.order_number = "Enter the order number from your confirmation email (for example #1001).";
      else if (!/^[A-Za-z0-9-]{1,32}$/.test(order)) errors.order_number = "That doesn't look like an order number (for example #1001).";

      var email = form.elements.email.value.trim();
      if (!email) errors.email = "Enter the email address you used at checkout.";
      else if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";

      var amount = form.elements.refund_amount.value.trim();
      if (amount && !/^\d{1,7}([.,]\d{1,2})?$/.test(amount.replace(/[^0-9.,]/g, ""))) {
        errors.refund_amount = "Enter an amount such as 14.99, or leave it blank.";
      }

      if (!form.elements.reason.value) errors.reason = "Choose the reason that best describes the problem.";
      if (form.elements.description.value.trim().length < 20) {
        errors.description = "Please describe the problem in at least 20 characters so we can help.";
      }

      ["screenshot", "video"].forEach(function (name) {
        var input = form.elements[name];
        var file = input.files && input.files[0];
        if (!file) return;
        var max = Number(input.getAttribute("data-max-bytes"));
        if (file.size > max) errors[name] = "This file is too large. The maximum is " + Math.round(max / 1048576) + " MB.";
        var accept = input.getAttribute("accept").split(",");
        if (file.type && accept.indexOf(file.type) === -1) {
          errors[name] = name === "screenshot" ? "Screenshots must be PNG, JPG or WebP images." : "Videos must be MP4, MOV or WebM files.";
        }
      });

      if (!form.elements.confirm_accurate.checked) errors.confirm_accurate = "Please confirm that the information is accurate.";
      return errors;
    }

    function setSubmitting(value) {
      submitting = value;
      submitBtn.disabled = value;
      submitBtn.textContent = value ? "Submitting…" : "Submit refund request";
      form.setAttribute("aria-busy", value ? "true" : "false");
    }

    function showSuccess(body) {
      root.querySelector("[data-vs-ticket-id]").textContent = body.ticketId;
      root.querySelector("[data-vs-success-email]").textContent = form.elements.email.value.trim();
      root.querySelector("[data-vs-duplicate-note]").hidden = !body.duplicate;
      formWrap.hidden = true;
      success.hidden = false;
      success.focus();
      success.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function submit() {
      if (submitting) return;
      clearErrors();
      var errors = validate();
      if (Object.keys(errors).length) {
        showErrors(errors);
        return;
      }

      setSubmitting(true);
      fetch(proxy + "/refund", {
        method: "POST",
        body: new FormData(form),
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      })
        .then(function (res) {
          if (res.status === 413) {
            return { ok: false, error: "too_large", message: "Your files are too large. Screenshots can be up to 5 MB and videos up to 20 MB." };
          }
          return res.json().catch(function () {
            return { ok: false, error: "bad_response", message: "Something went wrong and your request may not have been saved. Please try again." };
          });
        })
        .then(function (body) {
          if (body.ok) {
            showSuccess(body);
            return;
          }
          if (body.error === "order_not_matched") {
            unverified.querySelector("[data-vs-unverified-text]").textContent = body.message;
            unverified.hidden = false;
            unverified.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
          showErrors(body.fieldErrors || {}, body.message);
        })
        .catch(function () {
          showErrors({}, "We couldn't reach our server. Please check your connection and try again. Your details are still in the form.");
        })
        .then(function () {
          setSubmitting(false);
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      allowUnverified.value = "false";
      unverified.hidden = true;
      submit();
    });

    root.querySelector("[data-vs-submit-unverified]").addEventListener("click", function () {
      allowUnverified.value = "true";
      unverified.hidden = true;
      submit();
    });

    root.querySelector("[data-vs-fix-details]").addEventListener("click", function () {
      unverified.hidden = true;
      form.elements.order_number.focus();
    });
  }

  function boot() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-vs-refund]:not([data-ready])"), function (root) {
      root.setAttribute("data-ready", "true");
      init(root);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  document.addEventListener("shopify:section:load", boot);
})();
