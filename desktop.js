"use strict";

(() => {
  const DESKTOP_MARGIN = 6;
  const MINUTE_MS = 60_000;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const TIME_ZONE = "America/Argentina/Buenos_Aires";

  const desktop = document.querySelector("#desktop");
  const shortcuts = desktop.querySelector(".shortcuts");
  const titleBarTemplate = document.querySelector("#window-titlebar-template");
  const dock = document.querySelector("#dock-apps");
  const startButton = document.querySelector("#start-button");
  const startMenu = document.querySelector("#start-menu");
  const menuApps = document.querySelector("#menu-apps");
  const compactScreen = window.matchMedia("(max-width: 700px)");

  const apps = new Map();
  let activeApp = null;
  let topLayer = 2;

  // Cada seccion con data-window define una aplicacion del escritorio.
  function registerWindows() {
    for (const panel of desktop.querySelectorAll("[data-window]")) {
      const { window: id, title, icon } = panel.dataset;
      const titleBar = buildTitleBar(title, icon);
      const app = {
        title,
        panel,
        titleBar,
        titleLabel: titleBar.querySelector(".titlebar-label"),
        maximizeButton: titleBar.querySelector('[data-action="maximize"]'),
        body: panel.querySelector(".window-body"),
        dockButton: buildDockButton(id, title, icon, panel.id),
        state: panel.hidden ? "closed" : "open",
        layer: 2,
      };

      apps.set(id, app);
      panel.prepend(titleBar);
      dock.append(app.dockButton);
      menuApps.append(buildMenuButton(id, title, icon));
      bindWindowEvents(app);
      enableDrag(app);
    }
  }

  function buildTitleBar(title, icon) {
    const titleBar = titleBarTemplate.content.firstElementChild.cloneNode(true);
    titleBar.querySelector(".titlebar-label use").setAttribute("href", `#i-${icon}`);
    titleBar.querySelector("[data-window-name]").textContent = title;

    for (const button of titleBar.querySelectorAll("[data-action]")) {
      button.setAttribute("aria-label", `${button.title} ${title}`);
    }

    return titleBar;
  }

  function buildDockButton(id, title, glyph, panelId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dock-button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.setAttribute("aria-controls", panelId);
    button.append(createIcon(glyph));

    button.addEventListener("click", () => {
      const app = apps.get(id);
      if (app === activeApp) {
        hideWindow(app, "minimize");
      } else {
        openWindow(id);
      }
    });

    return button;
  }

  function buildMenuButton(id, title, glyph) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-app";
    button.dataset.open = id;
    button.append(createIcon(glyph), title);
    return button;
  }

  function createIcon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    const use = document.createElementNS(SVG_NS, "use");
    svg.setAttribute("aria-hidden", "true");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function bindWindowEvents(app) {
    const { panel, titleBar } = app;
    panel.addEventListener("pointerdown", () => activateWindow(app));
    panel.addEventListener("focusin", () => activateWindow(app));

    titleBar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;

      const { action } = button.dataset;
      if (action === "maximize") {
        toggleMaximize(app);
      } else {
        hideWindow(app, action);
      }
    });

    titleBar.addEventListener("dblclick", (event) => {
      if (!compactScreen.matches && !event.target.closest("button")) {
        toggleMaximize(app);
      }
    });
  }

  // Una ventana minimizada conserva su posicion; cerrar la restablece.
  function openWindow(id, focus = true) {
    const app = apps.get(id);
    if (!app) return;

    app.state = "open";
    app.panel.hidden = false;
    keepWindowInBounds(app.panel);
    activateWindow(app);
    closeStartMenu();

    if (focus) app.titleLabel.focus({ preventScroll: true });
  }

  function activateWindow(app) {
    if (!app || app.panel.hidden || app === activeApp) return;

    topLayer += 1;
    app.layer = topLayer;
    app.panel.style.zIndex = topLayer;
    activeApp = app;
    syncWindowControls();
  }

  function hideWindow(app, action) {
    const { panel } = app;
    panel.hidden = true;
    app.state = action === "close" ? "closed" : "minimized";

    if (action === "close") {
      panel.style.removeProperty("left");
      panel.style.removeProperty("top");
      setMaximized(app, false);
      app.body.scrollTop = 0;
    }

    // Devolver el primer plano a la ultima ventana que siga abierta.
    activeApp = null;
    let frontmost = null;
    for (const candidate of apps.values()) {
      if (!candidate.panel.hidden && (!frontmost || candidate.layer > frontmost.layer)) {
        frontmost = candidate;
      }
    }

    if (frontmost) {
      activateWindow(frontmost);
    } else {
      syncWindowControls();
    }

    app.dockButton.focus({ preventScroll: true });
  }

  function syncWindowControls() {
    for (const app of apps.values()) {
      const { dockButton, panel, state } = app;
      const isActive = app === activeApp;
      dockButton.classList.toggle("is-open", state !== "closed");
      dockButton.classList.toggle("is-active", isActive);
      dockButton.setAttribute("aria-expanded", String(!panel.hidden));
      panel.classList.toggle("is-active", isActive);
      // En celular, el teclado no debe entrar a las ventanas cubiertas.
      panel.inert = compactScreen.matches && !isActive;
    }

    shortcuts.inert = compactScreen.matches && activeApp !== null;
  }

  function toggleMaximize(app) {
    setMaximized(app, !app.panel.classList.contains("is-maximized"));
  }

  function setMaximized(app, maximized) {
    const { panel, title, maximizeButton } = app;
    panel.classList.toggle("is-maximized", maximized);
    maximizeButton.title = maximized ? "Restaurar" : "Maximizar";
    maximizeButton.setAttribute("aria-label", `${maximizeButton.title} ${title}`);
    maximizeButton.querySelector("use").setAttribute(
      "href",
      maximized ? "#i-restore" : "#i-max",
    );

    if (!maximized) keepWindowInBounds(panel);
  }

  // Posicion y tamano de las ventanas movibles.
  function enableDrag({ panel, titleBar }) {
    let drag = null;

    titleBar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || compactScreen.matches) return;
      if (event.target.closest("button") || panel.classList.contains("is-maximized")) {
        return;
      }

      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - panel.offsetLeft,
        offsetY: event.clientY - panel.offsetTop,
        limits: getWindowLimits(panel),
      };
      titleBar.setPointerCapture(event.pointerId);
      panel.classList.add("is-dragging");
    });

    titleBar.addEventListener("pointermove", (event) => {
      if (event.pointerId !== drag?.pointerId || compactScreen.matches) return;

      moveWindow(
        panel,
        event.clientX - drag.offsetX,
        event.clientY - drag.offsetY,
        drag.limits,
      );
    });

    titleBar.addEventListener("lostpointercapture", () => {
      drag = null;
      panel.classList.remove("is-dragging");
    });
  }

  function getWindowLimits(panel) {
    return {
      left: desktop.clientWidth - panel.offsetWidth - DESKTOP_MARGIN,
      top: desktop.clientHeight - panel.offsetHeight - DESKTOP_MARGIN,
    };
  }

  function moveWindow(panel, left, top, limits) {
    panel.style.left = `${clampPosition(left, limits.left)}px`;
    panel.style.top = `${clampPosition(top, limits.top)}px`;
  }

  function clampPosition(position, limit) {
    return Math.max(DESKTOP_MARGIN, Math.min(position, limit));
  }

  function keepWindowInBounds(panel) {
    if (compactScreen.matches || panel.hidden || !panel.style.left) return;
    if (panel.classList.contains("is-maximized")) return;

    moveWindow(panel, panel.offsetLeft, panel.offsetTop, getWindowLimits(panel));
  }

  function bindDesktopNavigation() {
    let resizeFrame = 0;

    document.addEventListener("click", (event) => {
      const launch = event.target.closest("[data-open]");
      if (launch) openWindow(launch.dataset.open);
    });

    const openFromHash = () => openWindow(location.hash.slice(1), false);
    window.addEventListener("hashchange", openFromHash);
    openFromHash();

    compactScreen.addEventListener("change", syncWindowControls);
    window.addEventListener("resize", () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        for (const { panel } of apps.values()) keepWindowInBounds(panel);
      });
    });
  }

  // Menu de inicio y navegacion con teclado.
  function closeStartMenu(restoreFocus = false) {
    startMenu.hidden = true;
    startButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) startButton.focus();
  }

  function bindStartMenu() {
    const buttons = [...menuApps.querySelectorAll("button")];
    const last = buttons.length - 1;

    startButton.addEventListener("click", () => {
      if (!startMenu.hidden) {
        closeStartMenu(true);
        return;
      }

      startMenu.hidden = false;
      startButton.setAttribute("aria-expanded", "true");
      buttons[0]?.focus();
    });

    menuApps.addEventListener("keydown", (event) => {
      const current = buttons.indexOf(document.activeElement);
      if (current < 0) return;

      const positions = {
        ArrowDown: current === last ? 0 : current + 1,
        ArrowUp: current === 0 ? last : current - 1,
        Home: 0,
        End: last,
      };
      const next = positions[event.key];
      if (!Number.isInteger(next)) return;

      event.preventDefault();
      buttons[next].focus();
    });

    startMenu.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next && next !== startButton && !startMenu.contains(next)) closeStartMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !startMenu.hidden) closeStartMenu(true);
    });

    document.addEventListener("click", (event) => {
      const outside = !startMenu.contains(event.target) && !startButton.contains(event.target);
      if (!startMenu.hidden && outside) closeStartMenu();
    });
  }

  function bindImageViewer() {
    const preview = document.querySelector("[data-zoom]");
    const dialog = document.querySelector("#image-viewer");

    preview.addEventListener("click", (event) => {
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      // Sin soporte para el visor, el enlace abre el archivo de imagen.
      if (modified || typeof dialog.showModal !== "function") return;

      event.preventDefault();
      dialog.showModal();
    });

    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const { left, right, top, bottom } = dialog.getBoundingClientRect();
      const outside = event.clientX < left || event.clientX > right
        || event.clientY < top || event.clientY > bottom;
      if (outside) dialog.close();
    });

    dialog.addEventListener("close", () => preview.focus({ preventScroll: true }));
  }

  function startClock() {
    const dateLabel = document.querySelector("#date");
    const clock = document.querySelector("#clock");
    const dateFormat = new Intl.DateTimeFormat("es-AR", {
      timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short",
    });
    const timeFormat = new Intl.DateTimeFormat("es-AR", {
      timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    let timer;

    function refresh() {
      clearTimeout(timer);
      if (document.hidden) return;

      const now = new Date();
      const date = dateFormat.format(now);
      const time = timeFormat.format(now);
      if (dateLabel.textContent !== date) dateLabel.textContent = date;
      if (clock.dateTime !== time) {
        clock.dateTime = time;
        clock.textContent = time;
      }
      timer = window.setTimeout(refresh, MINUTE_MS - (now.getTime() % MINUTE_MS));
    }

    document.addEventListener("visibilitychange", refresh);
    refresh();
  }

  registerWindows();
  activateWindow(apps.get("perfil"));
  bindDesktopNavigation();
  bindStartMenu();
  bindImageViewer();
  startClock();
})();
