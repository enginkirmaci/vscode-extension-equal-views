/*!
 * Equal Views side-car.
 *
 * Appended to workbench.desktop.main.js by the Equal Views extension. VS Code
 * has no API for sizing a view section, but its own splitter responds to a
 * double click by averaging the two views around it (PaneView#onDidSashReset).
 * This side-car replays that gesture over every splitter until the expanded
 * views of a region share the space evenly.
 */
(function () {
  'use strict';

  var CONFIG = /*__EQUAL_VIEWS_CONFIG__*/ null;

  if (!CONFIG || window.__equalViewsLoaded) {
    return;
  }
  window.__equalViewsLoaded = true;

  var REGIONS = {
    sidebar: '.part.sidebar',
    secondarySideBar: '.part.auxiliarybar',
    panel: '.part.panel'
  };

  var TOLERANCE = 2;
  var PASSES = 12;
  var INTERVAL = 400;

  function log() {
    if (!CONFIG.debug) {
      return;
    }
    try {
      console.log.apply(console, ['[equal-views]'].concat(Array.prototype.slice.call(arguments)));
    } catch (err) {
      // ignore
    }
  }

  function splitViewOf(root) {
    var element = root.querySelector('.monaco-split-view2');
    if (!element) {
      return null;
    }
    var container = element.querySelector('.split-view-container');
    var sashes = element.querySelector('.sash-container');
    return container && sashes ? { container: container, sashes: sashes } : null;
  }

  function expandedPanes(root) {
    var split = splitViewOf(root);
    if (!split) {
      return [];
    }
    var cells = split.container.children;
    var result = [];
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      if (!cell.classList || !cell.classList.contains('split-view-view')) {
        continue;
      }
      var pane = cell.firstElementChild;
      if (!pane || !pane.classList || !pane.classList.contains('pane')) {
        continue;
      }
      if (!pane.classList.contains('expanded')) {
        continue;
      }
      if (cell.getBoundingClientRect().height <= 0) {
        continue;
      }
      result.push(cell);
    }
    return result;
  }

  function splitters(root) {
    var split = splitViewOf(root);
    if (!split) {
      return [];
    }
    var nodes = split.sashes.children;
    var result = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node.classList || !node.classList.contains('monaco-sash')) {
        continue;
      }
      if (node.classList.contains('disabled')) {
        continue;
      }
      result.push(node);
    }
    return result;
  }

  function heights(cells) {
    var result = [];
    for (var i = 0; i < cells.length; i++) {
      result.push(cells[i].getBoundingClientRect().height);
    }
    return result;
  }

  function spread(values) {
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < values.length; i++) {
      if (values[i] < min) {
        min = values[i];
      }
      if (values[i] > max) {
        max = values[i];
      }
    }
    return max - min;
  }

  function equalize(root, done) {
    var pass = 0;

    function step() {
      var cells = expandedPanes(root);
      if (cells.length < 2) {
        done(false);
        return;
      }
      if (spread(heights(cells)) <= TOLERANCE) {
        done(true);
        return;
      }
      if (pass++ >= PASSES) {
        done(false);
        return;
      }
      var handles = splitters(root);
      for (var i = 0; i < handles.length; i++) {
        handles[i].dispatchEvent(new MouseEvent('dblclick', { bubbles: false, cancelable: true }));
      }
      window.requestAnimationFrame(step);
    }

    step();
  }

  /**
   * The part keeps one pane view per view container and only the active one is
   * laid out, so the visible pane view is looked up on every tick. That also
   * makes switching between Explorer, Search and Source Control work.
   */
  function visiblePaneView(part) {
    var candidates = part.querySelectorAll('.monaco-pane-view');
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var element = candidates[i];
      if (element.parentElement && element.parentElement.closest('.monaco-pane-view')) {
        continue;
      }
      var rect = element.getBoundingClientRect();
      if (rect.height <= 0 || rect.width <= 0) {
        continue;
      }
      if (!best || rect.height > best.height) {
        best = { element: element, height: rect.height };
      }
    }
    return best ? best.element : null;
  }

  function watch(name, selector) {
    var state = { root: null, signature: '', userSized: false, stuck: '', running: false };

    function signatureOf(root) {
      return expandedPanes(root).length + ':' + Math.round(root.getBoundingClientRect().height);
    }

    function tick() {
      var part = document.querySelector(selector);
      if (!part) {
        state.root = null;
        return;
      }
      var root = visiblePaneView(part);
      if (!root) {
        state.root = null;
        return;
      }

      var signature = signatureOf(root);
      if (root !== state.root || signature !== state.signature) {
        state.root = root;
        state.signature = signature;
        state.userSized = false;
        state.stuck = '';
      }

      if (state.running || state.userSized || state.stuck === signature) {
        return;
      }

      var cells = expandedPanes(root);
      if (cells.length < 2 || spread(heights(cells)) <= TOLERANCE) {
        return;
      }

      state.running = true;
      log('balancing', name, heights(cells));
      equalize(root, function (settled) {
        state.running = false;
        if (!settled) {
          // Never fight a region that cannot be split evenly (minimum sizes).
          state.stuck = state.signature;
          log('gave up on', name);
        }
      });
    }

    function start() {
      var part = document.querySelector(selector);
      if (!part) {
        window.setTimeout(start, 500);
        return;
      }
      part.addEventListener(
        'pointerdown',
        function (event) {
          var target = event.target;
          if (target && target.classList && target.classList.contains('monaco-sash')) {
            // A manual drag wins until the region changes shape again.
            state.userSized = true;
          }
        },
        true
      );
      window.setInterval(tick, CONFIG.interval || INTERVAL);
      tick();
    }

    start();
  }

  (CONFIG.targets || ['sidebar']).forEach(function (name) {
    var selector = REGIONS[name];
    if (selector) {
      watch(name, selector);
    }
  });
})();
