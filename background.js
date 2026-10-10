// Отложенные вкладки / Stashed tabs: the plugin's background page.
//
// The one writer of the plugin's data. The page (page.html) only reads it and
// sends messages here.
//
// Storage keys (driftPlugin.storage):
//   stashes   [{ id, name, createdAt, tabs: [{ url, title, pinned, groupId }],
//               groups: [{ id, name, color, collapsed }] }]
//             newest is decided by createdAt (ms since epoch); name "" means
//             "show how many tabs it holds" (the page words that per language)
//   settings  { showButtons: boolean }
//   migrated  true once the stashes the browser itself used to keep were copied
//
// Rules carried over from the browser's own implementation:
//   * restoring never deletes a stash; deleting is a separate act
//   * names are not unique, ids are the identity
//   * an empty set is refused; a stash that loses its last tab is removed
//   * at most 100 stashes, the oldest go first
//   * pinned and private tabs are never stashed (the browser leaves them out
//     of the snapshot)
(function () {
  var MAX_STASHES = 100;
  var MAX_IMPORT_TABS_PER_STASH = 200;

  // The window that last used the plugin's button, commands or page. The page
  // runs in a frame and does not know its own window, so a restore asked from
  // the page goes to this one.
  var lastWindow = "main";

  var counter = 0;
  function nextId() {
    return "st" + Date.now() + "-" + counter++;
  }

  // Every change to the stored list goes through here, one after another, so
  // two quick clicks cannot read the same list and overwrite each other.
  var queue = Promise.resolve();
  function serial(task) {
    var run = queue.then(task);
    queue = run.catch(function () {});
    return run;
  }

  function log(error) {
    console.error("[tab-stashes]", error);
  }

  function readStashes() {
    return driftPlugin.storage.get("stashes").then(function (value) {
      return Array.isArray(value) ? value : [];
    });
  }

  function writeStashes(list) {
    return driftPlugin.storage.set("stashes", list);
  }

  function readSettings() {
    return driftPlugin.storage.get("settings").then(function (value) {
      return { showButtons: !(value && value.showButtons === false) };
    });
  }

  function applyButton(settings) {
    return driftPlugin.ui.setButton({ visible: settings.showButtons });
  }

  function cleanTab(tab) {
    return {
      url: String(tab.url),
      title: String(tab.title || tab.url),
      pinned: false,
      groupId: tab.groupId || null,
    };
  }

  // The list with one more stash in it, or null for an empty set.
  function withStash(list, name, tabs, groups) {
    if (!tabs.length) return null;
    var next = list.concat([
      {
        id: nextId(),
        name: String(name || "").trim(),
        createdAt: Date.now(),
        tabs: tabs,
        groups: groups,
      },
    ]);
    if (next.length > MAX_STASHES) {
      next.sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });
      next = next.slice(0, MAX_STASHES);
    }
    return next;
  }

  // ---- Stashing ---------------------------------------------------------

  // Saves first and closes afterwards: if saving fails nothing is closed.
  // A second request for a window that is still being stashed is dropped: both
  // would snapshot the same tabs and save them twice.
  var stashing = {};

  function stashWindow(windowLabel, scope, name) {
    lastWindow = windowLabel || lastWindow;
    var key = String(windowLabel);
    if (stashing[key]) return Promise.resolve(0);
    stashing[key] = true;
    return stashWindowNow(windowLabel, scope, name).then(
      function (count) {
        delete stashing[key];
        return count;
      },
      function (error) {
        delete stashing[key];
        throw error;
      },
    );
  }

  function stashWindowNow(windowLabel, scope, name) {
    return driftPlugin.tabs.snapshot({ windowLabel: windowLabel, scope: scope }).then(function (snapshot) {
      if (!snapshot.tabs.length) return 0;
      var tabs = snapshot.tabs.map(cleanTab);
      return serial(function () {
        return readStashes().then(function (list) {
          return writeStashes(withStash(list, name, tabs, snapshot.groups));
        });
      })
        .then(function () {
          return driftPlugin.tabs.close({
            windowLabel: windowLabel,
            ids: snapshot.tabs.map(function (tab) {
              return tab.id;
            }),
          });
        })
        .then(function () {
          return tabs.length;
        });
    });
  }

  // ---- Migration --------------------------------------------------------

  function fromBrowser(stash) {
    return {
      id: String(stash.id),
      name: String(stash.name || ""),
      createdAt: Number(stash.createdAt) || 0,
      tabs: (stash.tabs || []).map(function (tab) {
        return {
          url: String(tab.url),
          title: String(tab.title || tab.url),
          pinned: !!tab.pinned,
          groupId: tab.groupId || null,
        };
      }),
      groups: (stash.groups || []).map(function (group) {
        return {
          id: String(group.id),
          name: String(group.name || ""),
          color: String(group.color || ""),
          collapsed: !!group.collapsed,
        };
      }),
    };
  }

  // Copies what the browser kept before this plugin existed: the stashes, and
  // whether the person had switched the buttons off. The browser's own file is
  // only read. Safe to run again: stashes already here (same id) are not added
  // twice, and it stops being tried once it has worked.
  function migrate() {
    return driftPlugin.storage.get("migrated").then(function (done) {
      if (done === true) return null;
      return driftPlugin.legacy.getStashes().then(function (legacy) {
        return serial(function () {
          return readStashes().then(function (list) {
            var have = {};
            list.forEach(function (stash) {
              have[stash.id] = true;
            });
            var added = (legacy.stashes || [])
              .filter(function (stash) {
                return !have[stash.id];
              })
              .map(fromBrowser);
            return writeStashes(list.concat(added))
              .then(function () {
                return driftPlugin.storage.get("settings");
              })
              .then(function (settings) {
                if (settings !== null && settings !== undefined) return null;
                return driftPlugin.storage.set("settings", { showButtons: legacy.showButtons !== false });
              })
              .then(function () {
                return driftPlugin.storage.set("migrated", true);
              });
          });
        });
      });
    });
  }

  var ready = migrate()
    .catch(log)
    .then(readSettings)
    .then(applyButton)
    .catch(log);

  // ---- Browser entry points --------------------------------------------

  function handleCommand(id, context) {
    var windowLabel = context.windowLabel;
    lastWindow = windowLabel || lastWindow;
    if (id === "open-list") return driftPlugin.ui.openPage({ windowLabel: windowLabel });
    if (id === "stash-tab") return stashWindow(windowLabel, "active", "");
    if (id === "stash-all") return stashWindow(windowLabel, "all", context.text || "");
    if (id === "@toolbar") return stashWindow(windowLabel, "all", "");
    return null;
  }

  driftPlugin.runtime.onCommand(function (id, context) {
    ready
      .then(function () {
        return handleCommand(id, context || {});
      })
      .catch(log);
  });

  // ---- Import / export format ------------------------------------------

  // "url | title" per line, a blank line between stashes: the format OneTab
  // reads and writes. Only http and https addresses are taken, so a pasted
  // `javascript:` line cannot ride in; a stray header line is skipped.
  function parseImport(text) {
    var blocks = String(text).replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/);
    var stashes = [];
    blocks.forEach(function (block) {
      var tabs = [];
      block.split("\n").forEach(function (raw) {
        var line = raw.trim();
        if (!line) return;
        var split = line.indexOf(" | ");
        var url = (split === -1 ? line : line.slice(0, split)).trim();
        var title = split === -1 ? "" : line.slice(split + 3).trim();
        var parsed;
        try {
          parsed = new URL(url);
        } catch (e) {
          return;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
        if (tabs.length >= MAX_IMPORT_TABS_PER_STASH) return;
        tabs.push({ url: url, title: title || url, pinned: false, groupId: null });
      });
      if (tabs.length) stashes.push(tabs);
    });
    return stashes;
  }

  // ---- Messages from the page ------------------------------------------

  function fail(error) {
    return { ok: false, error: error };
  }

  function change(edit) {
    return serial(function () {
      return readStashes().then(function (list) {
        var outcome = edit(list);
        if (outcome.error) return fail(outcome.error);
        return writeStashes(outcome.list).then(function () {
          return { ok: true };
        });
      });
    });
  }

  function open(tabs, groups) {
    return driftPlugin.tabs
      .open({ windowLabel: lastWindow, tabs: tabs, groups: groups })
      .then(function () {
        return { ok: true };
      });
  }

  function findStash(id) {
    return readStashes().then(function (list) {
      return (
        list.filter(function (stash) {
          return stash.id === id;
        })[0] || null
      );
    });
  }

  // Which tab of the stash a message means: the one at `index` if it still has
  // that address (the page's list may be a moment old), else the first with it.
  function tabIndex(stash, message) {
    var at = Number(message.index);
    if (stash.tabs[at] && stash.tabs[at].url === message.url) return at;
    for (var i = 0; i < stash.tabs.length; i++) {
      if (stash.tabs[i].url === message.url) return i;
    }
    return -1;
  }

  // Drops the groups no tab belongs to any more.
  function pruneGroups(stash) {
    var used = {};
    stash.tabs.forEach(function (tab) {
      if (tab.groupId) used[String(tab.groupId)] = true;
    });
    stash.groups = (stash.groups || []).filter(function (group) {
      return used[String(group.id)];
    });
  }

  function handlePage(message) {
    switch (message.type) {
      case "rename":
        return change(function (list) {
          var name = String(message.name || "").trim();
          if (!name) return { error: "name" };
          var found = list.filter(function (stash) {
            return stash.id === message.id;
          })[0];
          if (!found) return { error: "gone" };
          found.name = name;
          return { list: list };
        });

      case "remove":
        return change(function (list) {
          return {
            list: list.filter(function (stash) {
              return stash.id !== message.id;
            }),
          };
        });

      // Drops one tab, and the stash itself if that was its last.
      case "removeTab":
        return change(function (list) {
          list.forEach(function (stash) {
            if (stash.id !== message.id) return;
            var at = tabIndex(stash, message);
            if (at === -1) return;
            stash.tabs.splice(at, 1);
            pruneGroups(stash);
          });
          return {
            list: list.filter(function (stash) {
              return stash.tabs.length > 0;
            }),
          };
        });

      // Restoring leaves the stash where it is.
      case "restore":
        return findStash(message.id).then(function (stash) {
          if (!stash) return fail("gone");
          return open(stash.tabs, stash.groups || []);
        });

      case "restoreTab":
        return findStash(message.id).then(function (stash) {
          if (!stash) return fail("gone");
          var at = tabIndex(stash, message);
          if (at === -1) return fail("gone");
          var tab = stash.tabs[at];
          return open([{ url: tab.url, title: tab.title, pinned: false, groupId: null }], []);
        });

      case "import":
        return serial(function () {
          var imported = parseImport(message.text);
          if (!imported.length) return { ok: true, added: 0 };
          return readStashes().then(function (list) {
            imported.forEach(function (tabs) {
              list = withStash(list, "", tabs, []) || list;
            });
            return writeStashes(list).then(function () {
              return { ok: true, added: imported.length };
            });
          });
        });

      case "setShowButtons":
        return serial(function () {
          var settings = { showButtons: message.value !== false };
          return driftPlugin.storage
            .set("settings", settings)
            .then(function () {
              return applyButton(settings);
            })
            .then(function () {
              return { ok: true };
            });
        });

      default:
        return fail("unknown");
    }
  }

  driftPlugin.runtime.onPageMessage(function (message) {
    return ready
      .then(function () {
        return handlePage(message || {});
      })
      .catch(function (error) {
        log(error);
        return fail("failed");
      });
  });
})();
