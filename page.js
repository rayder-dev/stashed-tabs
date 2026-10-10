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
      full: "This plugin's storage is full (5 MB). Delete or export some stashes.",
      search: "Search stashes, links and titles",
      nothingFound: "Nothing found.",
      found: ["Found {n} stash", "Found {n} stashes"],
      restoreRemove: "Restore and delete",
      restoreSelected: "Restore selected ({n})",
      selectAll: "Select all tabs of this stash",
      selectTab: "Select this tab",
      collapse: "Collapse",
      expand: "Expand",
      collapseAll: "Collapse all",
      expandAll: "Expand all",
      removeDuplicates: "Remove duplicates ({n})",
      duplicatesRemoved: ["Removed {n} duplicate.", "Removed {n} duplicates."],
      stashDeleted: "Stash deleted.",
      stashesDeleted: ["Deleted {n} stash.", "Deleted {n} stashes."],
      undo: "Undo",
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
      full: "Хранилище плагина заполнено (5 МБ). Удалите или экспортируйте часть наборов.",
      search: "Поиск по наборам, ссылкам и названиям",
      nothingFound: "Ничего не найдено.",
      found: ["Найден {n} набор", "Найдено {n} набора", "Найдено {n} наборов"],
      restoreRemove: "Восстановить и удалить",
      restoreSelected: "Восстановить выбранные ({n})",
      selectAll: "Выбрать все вкладки набора",
      selectTab: "Выбрать эту вкладку",
      collapse: "Свернуть",
      expand: "Развернуть",
      collapseAll: "Свернуть все",
      expandAll: "Развернуть все",
      removeDuplicates: "Убрать дубли ({n})",
      duplicatesRemoved: ["Убран {n} дубль.", "Убрано {n} дубля.", "Убрано {n} дублей."],
      stashDeleted: "Набор удалён.",
      stashesDeleted: ["Удалён {n} набор.", "Удалено {n} набора.", "Удалено {n} наборов."],
      undo: "Отменить",
    },
  };

  var lang = "en";
  var stashes = [];
  var showButtons = true;
  var editing = null; // { id, draft }
  var importOpen = false;
  var importText = "";
  var exportText = null;
  var notice = null; // { text, action: { label, run } | null }
  var noticeTimer = null;
  var collapsed = {}; // stash id -> true while folded to its header
  var query = "";
  var selected = {}; // stash id -> { tab index -> url } of the ticked tabs
  var pendingUndo = []; // stashes deleted lately, which the notice can still put back
  var inFlight = {}; // messages sent and not yet answered

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
    // The same message again before the first is answered (a double click)
    // would open the tabs twice: it is dropped.
    var key = JSON.stringify(message);
    if (inFlight[key]) return Promise.resolve(null);
    inFlight[key] = true;
    return driftPlugin.runtime.sendMessage(message).then(function (reply) {
      delete inFlight[key];
      if (reply && reply.ok === false) {
        showNotice(
          reply.error === "gone"
            ? text("gone")
            : reply.error === "name"
              ? text("needsName")
              : reply.error === "full"
                ? text("full")
                : text("failed"),
        );
      }
      return reply;
    }, function () {
      delete inFlight[key];
      showNotice(text("failed"));
      return null;
    });
  }

  function load() {
    return Promise.all([
      driftPlugin.storage.get("stashes"),
      driftPlugin.storage.get("settings"),
      driftPlugin.storage.get("collapsed"),
    ]).then(function (values) {
      stashes = Array.isArray(values[0]) ? values[0] : [];
      showButtons = !(values[1] && values[1].showButtons === false);
      collapsed = values[2] && typeof values[2] === "object" ? values[2] : {};
      keepValidSelection();
      render();
    });
  }

  // Ticks only stay while the tab they were put on is still where it was.
  function keepValidSelection() {
    var next = {};
    stashes.forEach(function (stash) {
      var ticks = selected[stash.id];
      if (!ticks) return;
      var kept = {};
      Object.keys(ticks).forEach(function (index) {
        if (stash.tabs[index] && stash.tabs[index].url === ticks[index]) kept[index] = ticks[index];
      });
      if (Object.keys(kept).length) next[stash.id] = kept;
    });
    selected = next;
  }

  // A line under the header for a few seconds; with an action it stays longer
  // and carries a button (undoing a delete).
  function showNotice(message, action) {
    // Any other line takes the place of an undo offer, and the offer with it.
    if (!action) pendingUndo = [];
    notice = { text: message, action: action || null };
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () {
      notice = null;
      pendingUndo = [];
      render();
    }, action ? 10000 : 4000);
    render();
  }

  // After a delete: the stash comes back in the reply, and one click puts it
  // back. Several deleted in a row are all put back together.
  function offerUndo(reply) {
    if (!reply || !reply.ok || !reply.removed) return;
    pendingUndo.push(reply.removed);
    showNotice(pendingUndo.length === 1 ? text("stashDeleted") : plural(TEXT[lang].stashesDeleted, pendingUndo.length), {
      label: text("undo"),
      run: function () {
        var back = pendingUndo;
        pendingUndo = [];
        notice = null;
        back.forEach(function (stash) {
          send({ type: "restoreStash", stash: stash });
        });
      },
    });
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

  // The stashes a search leaves, each with the indexes of the tabs to show: all
  // of them when the name matched, else only the tabs whose address or title did.
  function visibleStashes(list) {
    var q = query.trim().toLowerCase();
    if (!q) {
      return list.map(function (stash) {
        return { stash: stash, indexes: null };
      });
    }
    var out = [];
    list.forEach(function (stash) {
      if ((stash.name || "").toLowerCase().indexOf(q) !== -1) {
        out.push({ stash: stash, indexes: null });
        return;
      }
      var indexes = [];
      stash.tabs.forEach(function (tab, index) {
        if ((tab.url + " " + (tab.title || "")).toLowerCase().indexOf(q) !== -1) indexes.push(index);
      });
      if (indexes.length) out.push({ stash: stash, indexes: indexes });
    });
    return out;
  }

  function header(list, shown) {
    var head = el("header", "header");
    head.appendChild(el("h1", "title", text("title")));
    if (list.length) {
      var total = list.reduce(function (sum, stash) {
        return sum + stash.tabs.length;
      }, 0);
      head.appendChild(
        el(
          "p",
          "subtitle",
          query.trim()
            ? plural(TEXT[lang].found, shown.length)
            : plural(TEXT[lang].stashes, list.length) + ", " + plural(TEXT[lang].tabs, total),
        ),
      );
    }
    var actions = el("div", "header-actions");
    // Not while searching: every match is open then, whatever was folded.
    if (shown.length && !query.trim()) {
      var allFolded = shown.every(function (entry) {
        return collapsed[entry.stash.id] === true;
      });
      actions.appendChild(
        button("secondary", text(allFolded ? "expandAll" : "collapseAll"), function () {
          send({ type: "setCollapsed", all: true, value: !allFolded });
        }),
      );
    }
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
    // Not while the person is typing in the search field above.
    window.setTimeout(function () {
      var active = document.activeElement;
      if (!active || active === document.body) box.focus();
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

  function checkbox(checked, label, onChange, focusKey) {
    var box = el("input", "tick");
    box.type = "checkbox";
    box.dataset.focus = focusKey;
    box.checked = checked;
    box.title = label;
    box.setAttribute("aria-label", label);
    box.addEventListener("change", function () {
      onChange(box.checked);
    });
    return box;
  }

  function stashCard(entry) {
    var stash = entry.stash;
    var ticks = selected[stash.id] || {};
    var ticked = Object.keys(ticks).length;
    // While searching every match is shown, whatever was folded.
    var folded = collapsed[stash.id] === true && !query.trim();
    var duplicates =
      stash.tabs.length -
      new Set(
        stash.tabs.map(function (tab) {
          return tab.url;
        }),
      ).size;

    var card = el("li", "stash");
    var head = el("div", "stash-header");
    var fold = button("chevron", folded ? "▸" : "▾", function () {
      send({ type: "setCollapsed", id: stash.id, value: !folded });
    }, text(folded ? "expand" : "collapse"));
    fold.setAttribute("aria-expanded", folded ? "false" : "true");
    fold.dataset.focus = "fold:" + stash.id;
    head.appendChild(fold);
    // "All" means the tabs on show: while searching, not the ones filtered out.
    var shownIndexes = [];
    stash.tabs.forEach(function (tab, index) {
      if (!entry.indexes || entry.indexes.indexOf(index) !== -1) shownIndexes.push(index);
    });
    var shownTicked = shownIndexes.filter(function (index) {
      return ticks[index] !== undefined;
    }).length;
    var all = checkbox(
      shownTicked > 0 && shownTicked === shownIndexes.length,
      text("selectAll"),
      function (on) {
        var mine = selected[stash.id] || (selected[stash.id] = {});
        shownIndexes.forEach(function (index) {
          if (on) mine[index] = stash.tabs[index].url;
          else delete mine[index];
        });
        if (!Object.keys(mine).length) delete selected[stash.id];
        render();
      },
      "all:" + stash.id,
    );
    all.indeterminate = shownTicked > 0 && shownTicked < shownIndexes.length;
    head.appendChild(all);
    head.appendChild(nameCell(stash));
    // An unnamed stash already shows its tab count as the name.
    var when = formatDate(stash.createdAt);
    head.appendChild(el("span", "meta", stash.name ? plural(TEXT[lang].tabs, stash.tabs.length) + " · " + when : when));
    var actions = el("div", "stash-actions");
    if (ticked) {
      actions.appendChild(
        button("primary", text("restoreSelected").replace("{n}", String(ticked)), function () {
          var picks = Object.keys(ticks).map(function (index) {
            return { index: Number(index), url: ticks[index] };
          });
          send({ type: "restoreTabs", id: stash.id, tabs: picks }).then(function (reply) {
            if (!reply || !reply.ok) return;
            delete selected[stash.id];
            render();
          });
        }),
      );
    }
    if (duplicates > 0) {
      actions.appendChild(
        button("secondary", text("removeDuplicates").replace("{n}", String(duplicates)), function () {
          send({ type: "dedupe", id: stash.id }).then(function (reply) {
            if (reply && reply.ok && reply.removed) showNotice(plural(TEXT[lang].duplicatesRemoved, reply.removed));
          });
        }),
      );
    }
    actions.appendChild(
      button(ticked ? "secondary" : "primary", text("restoreAll"), function () {
        send({ type: "restore", id: stash.id });
      }),
    );
    actions.appendChild(
      button("secondary", text("restoreRemove"), function () {
        send({ type: "restoreAndRemove", id: stash.id }).then(offerUndo);
      }),
    );
    actions.appendChild(
      button("danger", "×", function () {
        send({ type: "remove", id: stash.id }).then(offerUndo);
      }, text("deleteStash")),
    );
    head.appendChild(actions);
    card.appendChild(head);
    if (folded) return card;

    var tabs = el("ul", "tabs");
    stash.tabs.forEach(function (tab, index) {
      if (entry.indexes && entry.indexes.indexOf(index) === -1) return;
      var row = el("li", "tab");
      row.appendChild(
        checkbox(ticks[index] !== undefined, text("selectTab"), function (on) {
          var mine = selected[stash.id] || (selected[stash.id] = {});
          if (on) mine[index] = tab.url;
          else delete mine[index];
          if (!Object.keys(mine).length) delete selected[stash.id];
          render();
        }, "tick:" + stash.id + ":" + index),
      );
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

  function searchBox() {
    var box = el("input", "search");
    box.dataset.focus = "search";
    box.type = "search";
    box.value = query;
    box.placeholder = text("search");
    box.setAttribute("aria-label", text("search"));
    box.addEventListener("input", function () {
      query = box.value;
      render();
    });
    return box;
  }

  function noticeLine() {
    var line = el("div", "notice");
    line.appendChild(el("span", "notice-text", notice.text));
    if (notice.action) {
      var action = notice.action;
      line.appendChild(button("secondary notice-action", action.label, action.run));
    }
    return line;
  }

  function render() {
    var list = sorted();
    var shown = visibleStashes(list);
    var root = document.getElementById("root");
    // The page is rebuilt on every change: put the focus back on the same
    // control (the search field with its caret, a tick, a fold arrow), so the
    // keyboard keeps working.
    var focused = document.activeElement;
    var focusKey = focused && focused.dataset ? focused.dataset.focus : undefined;
    var caret = focusKey === "search" ? [focused.selectionStart, focused.selectionEnd] : null;

    var page = el("div", "page");
    page.appendChild(header(list, shown));
    if (list.length) page.appendChild(searchBox());
    if (notice) page.appendChild(noticeLine());
    if (exportText !== null) page.appendChild(exportPanel());
    if (importOpen) page.appendChild(importPanel());
    if (!list.length && !importOpen && exportText === null) page.appendChild(empty());
    if (list.length && !shown.length) page.appendChild(el("p", "empty-body not-found", text("nothingFound")));
    var ul = el("ul", "list");
    shown.forEach(function (entry) {
      ul.appendChild(stashCard(entry));
    });
    page.appendChild(ul);
    page.appendChild(settingsRow());
    root.replaceChildren(page);

    if (focusKey) {
      var again = Array.prototype.filter.call(root.querySelectorAll("[data-focus]"), function (node) {
        return node.dataset.focus === focusKey;
      })[0];
      if (again) {
        again.focus();
        if (caret) again.setSelectionRange(caret[0], caret[1]);
      }
    }
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
