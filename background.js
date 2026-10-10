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
//   collapsed { [stashId]: true }  the stashes folded to their header
//   migrated  true once the stashes the browser itself used to keep were copied
//
// Rules carried over from the browser's own implementation:
//   * restoring never deletes a stash; deleting is a separate act
//   * names are not unique, ids are the identity
//   * an empty set is refused; a stash that loses its last tab is removed
//   * at most 1000 stashes, the oldest go first
//   * pinned and private tabs are never stashed (the browser leaves them out
//     of the snapshot)
(function () {
  // The plugin's whole storage is capped at 5 MB by the browser; a thousand
  // stashes of a few dozen tabs fit. A save that does not fit fails and closes
  // nothing.
  var MAX_STASHES = 1000;
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

  // The tabs without a second one at an address already seen.
  function uniqueByUrl(tabs) {
    var seen = {};
    return tabs.filter(function (tab) {
      if (seen[tab.url]) return false;
      seen[tab.url] = true;
      return true;
    });
  }

  // The groups that at least one of `tabs` belongs to.
  function usedGroups(tabs, groups) {
    var used = {};
    tabs.forEach(function (tab) {
      if (tab.groupId) used[String(tab.groupId)] = true;
    });
    return (groups || []).filter(function (group) {
      return used[String(group.id)];
    });
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

  // The tabs to stash. The browser only knows "all" and "active", so the tabs
  // to the left or right of the current one are cut from the whole list. When
  // the current tab is not an ordinary page (it is not in the list) nothing is
  // stashed.
  function takeSnapshot(windowLabel, scope) {
    if (scope !== "left" && scope !== "right") {
      return driftPlugin.tabs.snapshot({ windowLabel: windowLabel, scope: scope });
    }
    var none = { tabs: [], groups: [] };
    return driftPlugin.tabs.snapshot({ windowLabel: windowLabel, scope: "active" }).then(function (active) {
      var current = active.tabs[0];
      if (!current) return none;
      return driftPlugin.tabs.snapshot({ windowLabel: windowLabel, scope: "all" }).then(function (all) {
        var at = -1;
        all.tabs.forEach(function (tab, index) {
          if (tab.id === current.id) at = index;
        });
        if (at === -1) return none;
        var tabs = scope === "left" ? all.tabs.slice(0, at) : all.tabs.slice(at + 1);
        return { tabs: tabs, groups: usedGroups(tabs, all.groups) };
      });
    });
  }

  function stashWindowNow(windowLabel, scope, name) {
    return takeSnapshot(windowLabel, scope).then(function (snapshot) {
      if (!snapshot.tabs.length) return 0;
      // A second tab at the same address is closed with the rest but not kept.
      var tabs = uniqueByUrl(snapshot.tabs.map(cleanTab));
      var groups = usedGroups(tabs, snapshot.groups);
      return serial(function () {
        return readStashes().then(function (list) {
          return writeStashes(withStash(list, name, tabs, groups));
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
    if (id === "stash-left") return stashWindow(windowLabel, "left", "");
    if (id === "stash-right") return stashWindow(windowLabel, "right", "");
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
          return Object.assign({ ok: true }, outcome.extra);
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
    stash.groups = usedGroups(stash.tabs, stash.groups);
  }

  // A stash the page hands back (undoing a delete): the same checks as for one
  // copied from the browser, and only http(s) addresses.
  function cleanReturned(stash) {
    var clean = fromBrowser(stash || {});
    clean.tabs = clean.tabs.filter(function (tab) {
      return /^https?:\/\//i.test(tab.url);
    });
    pruneGroups(clean);
    return clean;
  }

  // Ids of the stashes that still exist, as a lookup.
  function idsOf(list) {
    var ids = {};
    list.forEach(function (stash) {
      ids[stash.id] = true;
    });
    return ids;
  }

  // Remembers which stashes are folded; forgets the ones that are gone.
  function setCollapsed(message) {
    return serial(function () {
      return Promise.all([readStashes(), driftPlugin.storage.get("collapsed")]).then(function (values) {
        var ids = idsOf(values[0]);
        var current = values[1] && typeof values[1] === "object" ? values[1] : {};
        var next = {};
        Object.keys(ids).forEach(function (id) {
          var folded = message.all ? message.value === true : id === message.id ? message.value === true : current[id] === true;
          if (folded) next[id] = true;
        });
        return driftPlugin.storage.set("collapsed", next).then(function () {
          return { ok: true };
        });
      });
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

      // Hands the stash back so the page can offer to undo.
      case "remove":
        return change(function (list) {
          var removed = null;
          return {
            list: list.filter(function (stash) {
              if (stash.id !== message.id) return true;
              removed = stash;
              return false;
            }),
            extra: { removed: removed },
          };
        });

      // Puts back a stash that was just deleted, where its date puts it.
      case "restoreStash":
        return change(function (list) {
          var stash = cleanReturned(message.stash);
          if (!stash.tabs.length || idsOf(list)[stash.id]) return { list: list };
          var next = list.concat([stash]);
          if (next.length > MAX_STASHES) {
            next.sort(function (a, b) {
              return b.createdAt - a.createdAt;
            });
            next = next.slice(0, MAX_STASHES);
          }
          return { list: next };
        });

      // Takes out a second tab at an address already in the stash.
      case "dedupe":
        return change(function (list) {
          var removed = 0;
          list.forEach(function (stash) {
            if (stash.id !== message.id) return;
            var before = stash.tabs.length;
            stash.tabs = uniqueByUrl(stash.tabs);
            removed = before - stash.tabs.length;
            pruneGroups(stash);
          });
          return { list: list, extra: { removed: removed } };
        });

      case "setCollapsed":
        return setCollapsed(message);

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

      // Restores a stash and, once it is open, deletes it. The deleted stash
      // comes back so the page can offer to undo.
      case "restoreAndRemove":
        return findStash(message.id).then(function (stash) {
          if (!stash) return fail("gone");
          return open(stash.tabs, stash.groups || []).then(function () {
            return change(function (list) {
              return {
                list: list.filter(function (candidate) {
                  return candidate.id !== message.id;
                }),
                extra: { removed: stash },
              };
            });
          });
        });

      // The ticked tabs of one stash, each with the group it was in.
      case "restoreTabs":
        return findStash(message.id).then(function (stash) {
          if (!stash) return fail("gone");
          var taken = {};
          var tabs = [];
          (Array.isArray(message.tabs) ? message.tabs : []).forEach(function (pick) {
            var at = tabIndex(stash, pick || {});
            if (at === -1 || taken[at]) return;
            taken[at] = true;
            tabs.push(stash.tabs[at]);
          });
          if (!tabs.length) return fail("gone");
          return open(tabs, usedGroups(tabs, stash.groups));
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
        return fail(/storage is full/i.test(String(error && error.message ? error.message : error)) ? "full" : "failed");
      });
  });
})();
