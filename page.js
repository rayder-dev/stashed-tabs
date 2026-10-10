// Stashed tabs: the plugin's page. Runs in a sandboxed frame; `driftPlugin`
// comes from drift-page.js. It only reads the plugin's storage and sends
// messages to background.js, which is the one that writes.
(function () {
  var TEXT = {
    en: {
      title: "Stashed Tabs",
      stashes: ["{n} stash", "{n} stashes"],
      tabs: ["{n} tab", "{n} tabs"],
      export: "Export",
      import: "Import",
      cancel: "Cancel",
      restoreAll: "Restore all",
      deleteStash: "Delete this stash",
      rename: "Rename",
      removeTab: "Remove this tab from the stash",
      emptyTitle: "No stashes yet",
      emptyBody:
        "Press the toolbar button to sweep the window into a list. The tabs close; everything here can be restored later.",
      importHint: "One url | title per line. A blank line starts a new stash.",
      importPlaceholder: "https://example.com | Example\nhttps://example.org | Another",
      copied: "Copied every stash to the clipboard.",
      selectAndCopy: "Select the text and copy it.",
      nothingToExport: "There is nothing to export yet.",
      nothingImported: "Nothing in that text looked like a list of links.",
      imported: ["Imported {n} stash.", "Imported {n} stashes."],
      showButtons: "Show the toolbar button",
      showButtonsHint: "Stashing still works from the command palette (Ctrl+K).",
      gone: "That stash no longer exists.",
      needsName: "A stash needs a name.",
      failed: "Couldn't do that.",
    },
    ru: {
      title: "Отложенные вкладки",
      stashes: ["{n} набор", "{n} набора", "{n} наборов"],
      tabs: ["{n} вкладка", "{n} вкладки", "{n} вкладок"],
      export: "Экспорт",
      import: "Импорт",
      cancel: "Отмена",
      restoreAll: "Восстановить все",
      deleteStash: "Удалить этот набор",
      rename: "Переименовать",
      removeTab: "Убрать эту вкладку из набора",
      emptyTitle: "Наборов пока нет",
      emptyBody:
        "Нажмите кнопку на панели, чтобы убрать вкладки окна в список. Вкладки закроются, а всё здесь можно вернуть позже.",
      importHint: "Одна пара «адрес | название» в строке. Пустая строка начинает новый набор.",
      importPlaceholder: "https://example.com | Пример\nhttps://example.org | Другой",
      copied: "Все наборы скопированы в буфер обмена.",
      selectAndCopy: "Выделите текст и скопируйте его.",
      nothingToExport: "Пока нечего экспортировать.",
      nothingImported: "В этом тексте не нашлось списка ссылок.",
      imported: ["Импортирован {n} набор.", "Импортировано {n} набора.", "Импортировано {n} наборов."],
      showButtons: "Показывать кнопку на панели",
      showButtonsHint: "Откладывать вкладки по-прежнему можно из палитры команд (Ctrl+K).",
      gone: "Этого набора больше нет.",
      needsName: "У набора должно быть название.",
      failed: "Не получилось.",
    },
  };

  var lang = "en";
  var stashes = [];
  var showButtons = true;
  var editing = null; // { id, draft }
  var importOpen = false;
  var importText = "";
  var exportText = null;
  var notice = null;
  var noticeTimer = null;

  function text(key) {
    return (TEXT[lang] || TEXT.en)[key];
  }

  // The form for a count: English has two, Russian three.
  function plural(forms, n) {
    var index;
    if (lang === "ru") {
      var mod10 = n % 10;
      var mod100 = n % 100;
      index = mod10 === 1 && mod100 !== 11 ? 0 : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 1 : 2;
    } else {
      index = n === 1 ? 0 : 1;
    }
    return forms[index].replace("{n}", String(n));
  }

  function setLang(value) {
    lang = String(value || "en").slice(0, 2) === "ru" ? "ru" : "en";
    document.documentElement.lang = lang;
    document.title = text("title");
  }

  function hostOf(url) {
    try {
      return new URL(url).host.replace(/^www\./, "");
    } catch (e) {
      return url;
    }
  }

  function formatDate(ms) {
    return new Date(ms).toLocaleString(lang, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function sorted() {
    return stashes.slice().sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
  }

  // A stash without a name is shown by how many tabs it holds.
  function displayName(stash) {
    return stash.name || plural(TEXT[lang].tabs, stash.tabs.length);
  }

  // ---- Talking to the background page ---------------------------------

  function send(message) {
    return driftPlugin.runtime.sendMessage(message).then(function (reply) {
      if (reply && reply.ok === false) {
        showNotice(reply.error === "gone" ? text("gone") : reply.error === "name" ? text("needsName") : text("failed"));
      }
      return reply;
    }, function () {
      showNotice(text("failed"));
      return null;
    });
  }

  function load() {
    return Promise.all([driftPlugin.storage.get("stashes"), driftPlugin.storage.get("settings")]).then(function (values) {
      stashes = Array.isArray(values[0]) ? values[0] : [];
      showButtons = !(values[1] && values[1].showButtons === false);
      render();
    });
  }

  function showNotice(message) {
    notice = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () {
      notice = null;
      render();
    }, 4000);
    render();
  }

  // ---- Building the page -----------------------------------------------

  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function button(className, label, onClick, title) {
    var node = el("button", className, label);
    node.type = "button";
    if (title) {
      node.title = title;
      node.setAttribute("aria-label", title);
    }
    node.addEventListener("click", onClick);
    return node;
  }

  function header(list) {
    var head = el("header", "header");
    head.appendChild(el("h1", "title", text("title")));
    if (list.length) {
      var total = list.reduce(function (sum, stash) {
        return sum + stash.tabs.length;
      }, 0);
      head.appendChild(
        el("p", "subtitle", plural(TEXT[lang].stashes, list.length) + ", " + plural(TEXT[lang].tabs, total)),
      );
    }
    var actions = el("div", "header-actions");
    actions.appendChild(
      button("secondary", text("export"), function () {
        if (!stashes.length) {
          showNotice(text("nothingToExport"));
          return;
        }
        exportText = sorted()
          .map(function (stash) {
            return (
              stash.tabs
                .map(function (tab) {
                  var title = String(tab.title || "").trim();
                  return tab.url + (title ? " | " + title : "");
                })
                .join("\n") + "\n"
            );
          })
          .join("\n");
        importOpen = false;
        render();
        var box = document.getElementById("export-box");
        if (box) {
          box.focus();
          box.select();
          var copied = false;
          try {
            copied = document.execCommand("copy");
          } catch (e) {
            copied = false;
          }
          showNotice(copied ? text("copied") : text("selectAndCopy"));
          // The notice redrew the page, so the box is a new one: select again.
          box = document.getElementById("export-box");
          if (box) {
            box.focus();
            box.select();
          }
        }
      }),
    );
    actions.appendChild(
      button("secondary", text("import"), function () {
        importOpen = !importOpen;
        exportText = null;
        render();
      }),
    );
    head.appendChild(actions);
    return head;
  }

  function exportPanel() {
    var panel = el("section", "panel");
    var box = el("textarea", "box");
    box.id = "export-box";
    box.readOnly = true;
    box.rows = 8;
    box.spellcheck = false;
    box.value = exportText;
    panel.appendChild(box);
    var actions = el("div", "panel-actions");
    actions.appendChild(
      button("secondary", text("cancel"), function () {
        exportText = null;
        render();
      }),
    );
    panel.appendChild(actions);
    return panel;
  }

  function importPanel() {
    var panel = el("section", "panel");
    var label = el("label", "panel-label", text("importHint"));
    label.htmlFor = "import-box";
    panel.appendChild(label);
    var box = el("textarea", "box");
    box.id = "import-box";
    box.rows = 8;
    box.spellcheck = false;
    box.placeholder = text("importPlaceholder");
    box.value = importText;
    box.addEventListener("input", function () {
      importText = box.value;
    });
    panel.appendChild(box);
    var actions = el("div", "panel-actions");
    actions.appendChild(
      button("primary", text("import"), function () {
        send({ type: "import", text: importText }).then(function (reply) {
          if (!reply || !reply.ok) return;
          // Nothing found: keep the panel and the text so it can be corrected.
          if (reply.added === 0) {
            showNotice(text("nothingImported"));
            return;
          }
          importOpen = false;
          importText = "";
          showNotice(plural(TEXT[lang].imported, reply.added));
        });
      }),
    );
    actions.appendChild(
      button("secondary", text("cancel"), function () {
        importOpen = false;
        importText = "";
        render();
      }),
    );
    panel.appendChild(actions);
    window.setTimeout(function () {
      box.focus();
    }, 0);
    return panel;
  }

  function empty() {
    var box = el("div", "empty");
    box.appendChild(el("p", "empty-title", text("emptyTitle")));
    box.appendChild(el("p", "empty-body", text("emptyBody")));
    return box;
  }

  function commitRename(id, draft) {
    editing = null;
    var name = draft.trim();
    if (!name) {
      render();
      return;
    }
    send({ type: "rename", id: id, name: name });
    render();
  }

  function nameCell(stash) {
    if (editing && editing.id === stash.id) {
      var input = el("input", "name-input");
      input.value = editing.draft;
      var firstTime = !editing.opened;
      editing.opened = true;
      var remember = function () {
        editing.draft = input.value;
        editing.start = input.selectionStart;
        editing.end = input.selectionEnd;
      };
      input.addEventListener("input", remember);
      input.addEventListener("keyup", remember);
      input.addEventListener("click", remember);
      var done = false;
      input.addEventListener("blur", function () {
        // Redrawing the page removes the field: that is not the person leaving it.
        if (done || !editing || !input.isConnected) return;
        done = true;
        commitRename(stash.id, editing.draft);
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          done = true;
          commitRename(stash.id, input.value);
        } else if (event.key === "Escape") {
          done = true;
          editing = null;
          render();
        }
      });
      // Select the name once, when editing starts. A redraw while typing (a
      // notice, a change from another window) keeps the text and the caret.
      var state = editing;
      window.setTimeout(function () {
        input.focus();
        if (firstTime) input.select();
        else if (state.start !== undefined) input.setSelectionRange(state.start, state.end);
      }, 0);
      return input;
    }
    var name = button("name", displayName(stash), function () {
      editing = { id: stash.id, draft: stash.name || "" };
      render();
    }, text("rename"));
    return name;
  }

  function stashCard(stash) {
    var card = el("li", "stash");
    var head = el("div", "stash-header");
    head.appendChild(nameCell(stash));
    // An unnamed stash already shows its tab count as the name.
    var when = formatDate(stash.createdAt);
    head.appendChild(el("span", "meta", stash.name ? plural(TEXT[lang].tabs, stash.tabs.length) + " · " + when : when));
    var actions = el("div", "stash-actions");
    actions.appendChild(
      button("primary", text("restoreAll"), function () {
        send({ type: "restore", id: stash.id });
      }),
    );
    actions.appendChild(
      button("danger", "×", function () {
        send({ type: "remove", id: stash.id });
      }, text("deleteStash")),
    );
    head.appendChild(actions);
    card.appendChild(head);

    var tabs = el("ul", "tabs");
    stash.tabs.forEach(function (tab, index) {
      var row = el("li", "tab");
      var link = el("button", "tab-link");
      link.type = "button";
      link.title = tab.url;
      link.appendChild(el("span", "tab-host", hostOf(tab.url)));
      link.appendChild(el("span", "tab-title", tab.title || tab.url));
      link.addEventListener("click", function () {
        send({ type: "restoreTab", id: stash.id, index: index, url: tab.url });
      });
      row.appendChild(link);
      row.appendChild(
        button("tab-remove", "×", function () {
          send({ type: "removeTab", id: stash.id, index: index, url: tab.url });
        }, text("removeTab")),
      );
      tabs.appendChild(row);
    });
    card.appendChild(tabs);
    return card;
  }

  function settingsRow() {
    var row = el("label", "setting");
    var box = el("input");
    box.type = "checkbox";
    box.checked = showButtons;
    box.addEventListener("change", function () {
      send({ type: "setShowButtons", value: box.checked });
    });
    row.appendChild(box);
    var words = el("span", "setting-text");
    words.appendChild(el("span", "setting-title", text("showButtons")));
    words.appendChild(el("span", "setting-hint", text("showButtonsHint")));
    row.appendChild(words);
    return row;
  }

  function render() {
    var list = sorted();
    var root = document.getElementById("root");
    var page = el("div", "page");
    page.appendChild(header(list));
    if (notice) page.appendChild(el("div", "notice", notice));
    if (exportText !== null) page.appendChild(exportPanel());
    if (importOpen) page.appendChild(importPanel());
    if (!list.length && !importOpen && exportText === null) page.appendChild(empty());
    var ul = el("ul", "list");
    list.forEach(function (stash) {
      ul.appendChild(stashCard(stash));
    });
    page.appendChild(ul);
    page.appendChild(settingsRow());
    root.replaceChildren(page);
  }

  // ---- Start ----------------------------------------------------------

  setLang(document.documentElement.lang);
  driftPlugin.onTheme(function (info) {
    setLang(info.lang);
    render();
  });
  // The background page wrote: read again.
  driftPlugin.onStorageChanged(function () {
    load();
  });
  render();
  driftPlugin.ready.then(load, load);
})();
