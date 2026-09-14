// Copyright © 2026 Hendrik Leethaus <hendrik@leethaus.de>
//
// SPDX-License-Identifier: GPL-3.0-or-later

document.addEventListener("DOMContentLoaded", () => {
  const confirmDialog = createConfirmDialog();
  // In Zen mode the rows are refreshed in place instead of reloading the page
  const isZen = document.querySelector("table.zen") !== null;

  const srStatus = document.createElement("div");
  srStatus.className = "visually-hidden";
  srStatus.setAttribute("role", "status");
  srStatus.setAttribute("aria-live", "polite");
  srStatus.setAttribute("aria-atomic", "true");
  document.body.appendChild(srStatus);

  // Delegated, so that buttons loaded later (Zen infinite scroll) work too
  delegate(document, "click", ".aa-accept-all-btn", async function (e) {
    e.preventDefault();
    const username = this.dataset.username;
    const url = this.dataset.translationUrl;
    const csrfToken = getCsrfToken();

    this.classList.remove("aa-error");

    if (!csrfToken) {
      showError(
        this,
        gettext("Security token missing. Please reload the page."),
      );
      return;
    }

    const allBtns = document.querySelectorAll(".aa-accept-all-btn");
    disableAllButtons(allBtns);
    srStatus.textContent = interpolate(
      gettext("Loading suggestion count for %s"),
      [username],
    );

    try {
      const preview = await postBulkAccept(url, csrfToken, {
        username: username,
        preview: "1",
      });

      const confirmed = await confirmBulkAccept(
        confirmDialog,
        username,
        preview.total,
        preview.can_approve,
        this.dataset.translationName,
      );
      if (!confirmed) {
        enableAllButtons(allBtns);
        srStatus.textContent = gettext("Bulk accept cancelled.");
        return;
      }

      srStatus.textContent = interpolate(
        gettext("Scheduling bulk accept for %s"),
        [username],
      );

      const data = await postBulkAccept(url, csrfToken, {
        username: username,
        confirmed: "1",
        // The return URL makes the task poller leave the page, Zen stays put
        ...(isZen
          ? {}
          : {
              return_url: `${window.location.pathname}${window.location.search}${window.location.hash}`,
            }),
        ...(confirmed === "approve" ? { approve: "1" } : {}),
      });

      if (!data.success) {
        showError(this, data.error || gettext("Unknown error"));
        enableAllButtons(allBtns);
        return;
      }

      srStatus.textContent = data.message;
      if (!isZen) {
        setTimeout(() => location.reload(), data.completed ? 1500 : 100);
        return;
      }

      if (!data.completed) {
        const result = await waitForTask(data.task_url);
        if (result?.message) {
          srStatus.textContent = result.message;
        }
      }
      addAlert(srStatus.textContent, "success");
      document.dispatchEvent(new CustomEvent("weblate:suggestions-changed"));
      enableAllButtons(document.querySelectorAll(".aa-accept-all-btn"));
    } catch (err) {
      console.error("Bulk accept error:", err);
      showError(this, err.message || gettext("Network error"));
      enableAllButtons(allBtns);
    }
  });

  /* Poll a task until it completes, resolving with its result */
  function waitForTask(taskUrl) {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const response = await fetch(taskUrl, {
            credentials: "same-origin",
            headers: { "X-Requested-With": "XMLHttpRequest" },
          });
          if (response.status === 404) {
            resolve(null);
            return;
          }
          if (response.ok) {
            const data = await response.json();
            if (data.completed) {
              resolve(data.result);
              return;
            }
          }
        } catch (_error) {
          /* Ignore transient network errors and retry on the next tick */
        }
        setTimeout(poll, 1000);
      };
      if (!taskUrl) {
        reject(new Error(gettext("Invalid server response")));
        return;
      }
      poll();
    });
  }

  function getCsrfToken() {
    const csrfTokenElement = document.querySelector(
      "[name=csrfmiddlewaretoken]",
    );
    return csrfTokenElement?.value;
  }

  async function postBulkAccept(url, csrfToken, data) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-CSRFToken": csrfToken,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(data),
    });

    let responseData;
    try {
      responseData = await response.json();
    } catch (_parseError) {
      if (response.ok) {
        throw new Error(gettext("Invalid server response"));
      }
      responseData = {};
    }

    if (!response.ok) {
      throw new Error(
        responseData.error ||
          response.statusText ||
          interpolate(gettext("Server error (%s)"), [response.status]),
      );
    }

    if (
      responseData === null ||
      typeof responseData !== "object" ||
      Array.isArray(responseData)
    ) {
      throw new Error(gettext("Invalid server response"));
    }

    return responseData;
  }

  function confirmBulkAccept(dialog, username, total, canApprove, translation) {
    return new Promise((resolve) => {
      let resolved = false;
      const modal = bootstrap.Modal.getOrCreateInstance(dialog.element);

      if (total === 0) {
        dialog.body.textContent = interpolate(
          gettext(
            "There are no pending suggestions from %(username)s in %(translation)s.",
          ),
          { username, translation },
          true,
        );
        dialog.confirmButton.disabled = true;
        dialog.approveButton.disabled = true;
      } else {
        dialog.body.textContent = interpolate(
          ngettext(
            "This will accept %(count)s suggestion from %(username)s in %(translation)s.",
            "This will accept %(count)s suggestions from %(username)s in %(translation)s.",
            total,
          ),
          { count: total, username, translation },
          true,
        );
        dialog.confirmButton.disabled = false;
        dialog.approveButton.disabled = false;
      }
      dialog.approveButton.hidden = !canApprove;

      const finish = (value) => {
        if (resolved) {
          return;
        }
        resolved = true;
        dialog.confirmButton.removeEventListener("click", confirm);
        dialog.approveButton.removeEventListener("click", approve);
        dialog.element.removeEventListener("hidden.bs.modal", cancel);
        resolve(value);
      };

      const confirm = () => {
        finish("accept");
        modal.hide();
      };

      const approve = () => {
        finish("approve");
        modal.hide();
      };

      const cancel = () => {
        finish(false);
      };

      dialog.confirmButton.addEventListener("click", confirm);
      dialog.approveButton.addEventListener("click", approve);
      dialog.element.addEventListener("hidden.bs.modal", cancel);
      modal.show();
    });
  }

  function createConfirmDialog() {
    const element = document.createElement("div");
    element.className = "modal fade";
    element.tabIndex = -1;
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-labelledby", "bulk-accept-suggestions-title");

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog modal-lg";
    dialog.setAttribute("role", "document");

    const content = document.createElement("div");
    content.className = "modal-content";

    const header = document.createElement("div");
    header.className = "modal-header";

    const title = document.createElement("h4");
    title.id = "bulk-accept-suggestions-title";
    title.className = "modal-title";
    title.textContent = gettext("Accept all suggestions?");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "btn-close";
    closeButton.setAttribute("data-bs-dismiss", "modal");
    closeButton.setAttribute("aria-label", gettext("Close"));

    const body = document.createElement("div");
    body.className = "modal-body";

    const footer = document.createElement("div");
    footer.className = "modal-footer";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "btn btn-link";
    cancelButton.setAttribute("data-bs-dismiss", "modal");
    cancelButton.textContent = gettext("Cancel");

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "btn btn-primary";
    confirmButton.textContent = gettext("Accept suggestions");

    const approveButton = document.createElement("button");
    approveButton.type = "button";
    approveButton.className = "btn btn-primary";
    approveButton.textContent = gettext("Accept and approve suggestions");

    header.append(title, closeButton);
    footer.append(cancelButton, approveButton, confirmButton);
    content.append(header, body, footer);
    dialog.append(content);
    element.append(dialog);
    document.body.appendChild(element);

    return {
      element: element,
      body: body,
      confirmButton: confirmButton,
      approveButton: approveButton,
    };
  }

  function showError(button, message) {
    const error = interpolate(gettext("Error: %s"), [message]);
    button.classList.add("aa-error");
    button.setAttribute("aria-label", error);
    button.setAttribute("title", error);
    button.setAttribute("aria-busy", "false");
    srStatus.textContent = error;
  }

  function disableAllButtons(buttons) {
    for (const btn of buttons) {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
    }
  }

  function enableAllButtons(buttons) {
    for (const btn of buttons) {
      btn.disabled = false;
      btn.setAttribute("aria-busy", "false");
    }
  }
});
