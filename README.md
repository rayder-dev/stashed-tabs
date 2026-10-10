# Stashed Tabs

A plugin for the Drift browser (0.2.0 or newer). Sweep your open tabs into a named list, close them, and bring them back later.

## What it does

- **Stash all tabs** — the toolbar button saves every tab of the window as one stash and closes them.
- **Stash one tab, or the tabs to the left or right of it** — from the command palette (Ctrl+K). Left and right work when the current tab is an ordinary page.
- **Stashed tabs page** — all stashes, newest first. Search by name, address or title. Fold a stash to its header. Tick tabs and restore only those, restore a whole stash, or restore and delete it. Rename a stash by clicking its name, remove a tab or a stash (with an Undo), remove duplicate addresses.
- **Import / export** — plain text, one `url | title` per line, a blank line between stashes (the OneTab format).
- **Keeps what you had** — stashes the browser kept before this plugin existed are copied in on first run.

Restoring never deletes a stash. Pinned and private tabs are not stashed. At most 1000 stashes are kept; the oldest go first. The browser also caps the plugin's whole storage at 5 MB; a stash that does not fit is not saved and its tabs stay open.

Everything is stored locally in the plugin's own storage. Interface languages: English, Русский.

## Русский

Плагин для браузера Drift (0.2.0 и новее). Откладывает открытые вкладки в именованный набор и закрывает их, потом всё можно вернуть.

- **Отложить все вкладки** — кнопка на панели.
- **Отложить вкладку** — из палитры команд (Ctrl+K).
- **Страница отложенных вкладок** — восстановить набор целиком или одну вкладку, переименовать набор, удалить вкладку или набор.
- **Импорт и экспорт** — текст формата OneTab: `адрес | название` в строке, пустая строка между наборами.

Восстановление набор не удаляет. Закреплённые и приватные вкладки не откладываются. Хранится до 1000 наборов, старые удаляются первыми. Всё хранилище плагина браузер ограничивает 5 МБ: если набор не помещается, он не сохраняется, а вкладки остаются открытыми.
