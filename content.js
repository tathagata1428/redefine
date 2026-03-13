// Content script — detects text boxes, injects refine button + popup

const MIN_TEXT_LENGTH = 15;
const BUTTON_CLASS = "rs-refine-btn";
const TIPS_BUTTON_CLASS = "rs-tips-btn";
const BUTTON_WRAP_CLASS = "rs-btn-wrap";
const COG_BUTTON_CLASS = "rs-cog-btn";
const POPUP_CLASS = "rs-popup";
const SETTINGS_POPUP_CLASS = "rs-settings-popup";

let activePopup = null;
let activeSettingsPopup = null;
let activeButtonWrap = null;
let isEnabled = true;

// Guard against "Extension context invalidated" after reload/update
function isContextValid() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function cleanupOnInvalidContext() {
  hideAll();
  observer.disconnect();
}

// Load initial enabled state
if (isContextValid()) {
  chrome.storage.sync.get({ enabled: true }, (items) => {
    if (chrome.runtime.lastError) return;
    isEnabled = items.enabled;
    if (!isEnabled) hideAll();
  });
}

// Listen for enable/disable toggle from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (!isContextValid()) { cleanupOnInvalidContext(); return; }
  if (msg.action === "toggleEnabled") {
    isEnabled = msg.enabled;
    if (!isEnabled) {
      hideAll();
    }
  }
});

function hideAll() {
  closePopup();
  closeSettingsPopup();
  if (activeButtonWrap) {
    activeButtonWrap.remove();
    activeButtonWrap = null;
  }
  // Remove any lingering button wraps
  document.querySelectorAll(`.${BUTTON_WRAP_CLASS}`).forEach((el) => el.remove());
}

// --- Observe DOM for dynamically added textareas/contenteditable ---
function isTextInput(el) {
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT" && el.type === "text") return false; // skip short inputs
  const ce = el.getAttribute("contenteditable");
  if (ce === "true" || ce === "plaintext-only" || ce === "") return true;
  if (el.getAttribute("role") === "textbox") return true;
  if (el.isContentEditable) return true;
  return false;
}

function getTextFromElement(el) {
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value;
  return el.innerText || el.textContent || "";
}

function setTextToElement(el, text) {
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    // Trigger proper React/framework change events
    const nativeInputValueSetter =
      Object.getOwnPropertyDescriptor(
        el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        "value"
      ).set;
    nativeInputValueSetter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    el.innerText = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// --- Create the button wrapper with Refine + Tips buttons ---
function createButtonWrap(targetEl) {
  const wrap = document.createElement("div");
  wrap.className = BUTTON_WRAP_CLASS;

  const refineBtn = document.createElement("button");
  refineBtn.className = BUTTON_CLASS;
  refineBtn.textContent = "Refine";
  refineBtn.title = "Refine this text with AI";
  refineBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleRefine(targetEl, refineBtn);
  });

  const tipsBtn = document.createElement("button");
  tipsBtn.className = TIPS_BUTTON_CLASS;
  tipsBtn.textContent = "Writing Tips";
  tipsBtn.title = "Get personalized writing tips";
  tipsBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleTips(targetEl, tipsBtn);
  });

  const cogBtn = document.createElement("button");
  cogBtn.className = COG_BUTTON_CLASS;
  cogBtn.innerHTML = "&#9881;";
  cogBtn.title = "Quick settings";
  cogBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSettingsPopup(cogBtn);
  });

  wrap.appendChild(refineBtn);
  wrap.appendChild(tipsBtn);
  wrap.appendChild(cogBtn);
  return wrap;
}

// --- Get caret (cursor) coordinates inside a text element ---
function getCaretCoords(el) {
  // For contenteditable elements, use the Selection API
  if (el.isContentEditable || el.getAttribute("contenteditable")) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0).cloneRange();
      range.collapse(false);
      let rect = range.getBoundingClientRect();
      if (rect && (rect.height > 0 || rect.width > 0)) {
        return { top: rect.bottom, left: rect.left };
      }
      // Collapsed cursor may return a zero rect — insert a temp marker
      const marker = document.createElement("span");
      marker.textContent = "\u200b";
      range.insertNode(marker);
      rect = marker.getBoundingClientRect();
      const coords = { top: rect.bottom, left: rect.left };
      marker.remove();
      // Restore selection
      const restored = sel.getRangeAt(0);
      restored.collapse(false);
      return coords;
    }
  }

  // For textareas, mirror the text up to the cursor to measure position
  if (el.tagName === "TEXTAREA") {
    const mirror = document.createElement("div");
    const style = window.getComputedStyle(el);
    const props = [
      "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
      "wordSpacing", "textIndent", "whiteSpace", "wordWrap", "overflowWrap",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "boxSizing", "width"
    ];
    mirror.style.position = "fixed";
    mirror.style.left = "-9999px";
    mirror.style.top = "0";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    props.forEach((p) => (mirror.style[p] = style[p]));
    document.body.appendChild(mirror);

    const text = el.value.substring(0, el.selectionEnd);
    mirror.textContent = text;
    // Add a trailing marker span
    const span = document.createElement("span");
    span.textContent = "|";
    mirror.appendChild(span);

    const elRect = el.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    const coords = {
      top: elRect.top + (spanRect.top - mirrorRect.top) - el.scrollTop + span.offsetHeight,
      left: elRect.left + (spanRect.left - mirrorRect.left) - el.scrollLeft,
    };
    mirror.remove();
    return coords;
  }

  // Fallback: top of element
  const rect = el.getBoundingClientRect();
  return { top: rect.top + 30, left: rect.right - 80 };
}

// --- Position button wrapper near the cursor (2-3 lines below caret) ---
function positionButtonWrap(wrap, targetEl) {
  const caret = getCaretCoords(targetEl);
  const LINE_OFFSET = 40; // ~2-3 lines below the cursor
  const elRect = targetEl.getBoundingClientRect();

  // Clamp within the element bounds vertically (don't go below the element)
  let top = caret.top + LINE_OFFSET;
  top = Math.min(top, elRect.bottom + 4);
  // Also keep it on screen
  top = Math.min(top, window.innerHeight - 40);

  wrap.style.position = "fixed";
  wrap.style.top = `${top}px`;
  wrap.style.left = `${Math.min(caret.left + 20, elRect.right - 200)}px`;
  wrap.style.zIndex = "2147483647";
}

// --- Show / hide buttons on focus ---
function attachToElement(el) {
  if (el.dataset.rsAttached) return;
  el.dataset.rsAttached = "true";

  let currentWrap = null;
  let repositionScroll = null;
  let repositionResize = null;

  function showButton() {
    if (!isEnabled) return;
    // Already showing for this element
    if (currentWrap && currentWrap.isConnected) {
      positionButtonWrap(currentWrap, el);
      return;
    }

    // Remove any other active button wrap
    if (activeButtonWrap && activeButtonWrap !== currentWrap) activeButtonWrap.remove();

    const wrap = createButtonWrap(el);
    document.body.appendChild(wrap);
    positionButtonWrap(wrap, el);
    currentWrap = wrap;
    activeButtonWrap = wrap;

    // Reposition on scroll/resize
    if (repositionScroll) window.removeEventListener("scroll", repositionScroll);
    if (repositionResize) window.removeEventListener("resize", repositionResize);
    repositionScroll = () => positionButtonWrap(wrap, el);
    repositionResize = () => positionButtonWrap(wrap, el);
    window.addEventListener("scroll", repositionScroll, { passive: true });
    window.addEventListener("resize", repositionResize, { passive: true });
  }

  function hideButton() {
    // Delay removal so button click can register
    setTimeout(() => {
      if (currentWrap && !currentWrap.matches(":hover") && !document.querySelector(`.${POPUP_CLASS}`) && !document.querySelector(`.${SETTINGS_POPUP_CLASS}`)) {
        currentWrap.remove();
        if (activeButtonWrap === currentWrap) activeButtonWrap = null;
        currentWrap = null;
        if (repositionScroll) window.removeEventListener("scroll", repositionScroll);
        if (repositionResize) window.removeEventListener("resize", repositionResize);
      }
    }, 400);
  }

  el.addEventListener("focus", showButton);
  el.addEventListener("input", showButton);
  el.addEventListener("click", showButton);
  el.addEventListener("blur", hideButton);
}

// --- Handle the refine action ---
async function handleRefine(el, btn) {
  const text = getTextFromElement(el);
  if (text.trim().length < MIN_TEXT_LENGTH) {
    showPopup(el, null, "Type at least 15 characters to refine.");
    return;
  }

  // Show loading state
  btn.textContent = "...";
  btn.disabled = true;

  // Get settings
  const settings = await chrome.storage.sync.get({
    tone: "Professional",
    language: "English",
    detail: "Balanced",
  });

  chrome.runtime.sendMessage(
    { action: "refine", text, tone: settings.tone, language: settings.language, detail: settings.detail },
    (response) => {
      btn.textContent = "Refine";
      btn.disabled = false;

      if (chrome.runtime.lastError) {
        showPopup(el, null, "Extension error: " + chrome.runtime.lastError.message);
        return;
      }

      if (response.success) {
        showPopup(el, response.data);
      } else {
        showPopup(el, null, response.error);
      }
    }
  );
}

// --- Handle the writing tips action ---
async function handleTips(el, btn) {
  const text = getTextFromElement(el);
  if (text.trim().length < MIN_TEXT_LENGTH) {
    showPopup(el, null, "Type at least 15 characters to get tips.");
    return;
  }

  btn.textContent = "...";
  btn.disabled = true;

  chrome.runtime.sendMessage(
    { action: "tips", text },
    (response) => {
      btn.textContent = "Writing Tips";
      btn.disabled = false;

      if (chrome.runtime.lastError) {
        showPopup(el, null, "Extension error: " + chrome.runtime.lastError.message);
        return;
      }

      if (response.success) {
        showTipsPopup(el, response.data);
      } else {
        showPopup(el, null, response.error);
      }
    }
  );
}

// --- Show tips popup below the text element ---
function showTipsPopup(targetEl, tips) {
  closePopup();

  const popup = document.createElement("div");
  popup.className = POPUP_CLASS;

  // Build tips HTML list
  let tipsHtml = "";
  if (Array.isArray(tips)) {
    tipsHtml = tips.map((tip) => {
      const icon = tip.type === "strength" ? "&#9989;" : tip.type === "warning" ? "&#9888;&#65039;" : "&#128161;";
      return `<div class="rs-tip-item rs-tip-${tip.type || "suggestion"}">
        <span class="rs-tip-icon">${icon}</span>
        <div class="rs-tip-content">
          <strong>${escapeHtml(tip.title || "")}</strong>
          <p>${escapeHtml(tip.detail || "")}</p>
        </div>
      </div>`;
    }).join("");
  } else {
    tipsHtml = `<p>${escapeHtml(String(tips))}</p>`;
  }

  popup.innerHTML = `
    <div class="rs-popup-header rs-tips-header">
      <span class="rs-popup-title">Writing Tips</span>
      <button class="rs-popup-close">&times;</button>
    </div>
    <div class="rs-popup-body rs-tips-body">${tipsHtml}</div>
    <div class="rs-popup-actions">
      <button class="rs-popup-dismiss">Got it</button>
    </div>
  `;

  popup.querySelector(".rs-popup-close").addEventListener("click", closePopup);
  popup.querySelector(".rs-popup-dismiss").addEventListener("click", closePopup);

  document.body.appendChild(popup);
  const rect = targetEl.getBoundingClientRect();
  popup.style.position = "fixed";
  popup.style.top = `${rect.bottom + 8}px`;
  popup.style.left = `${rect.left}px`;
  popup.style.maxWidth = `${Math.max(rect.width, 380)}px`;
  popup.style.zIndex = "2147483647";

  makeDraggable(popup);
  activePopup = popup;
}

// --- Show popup below the text element ---
function showPopup(targetEl, refinedText, errorMsg) {
  closePopup();

  const popup = document.createElement("div");
  popup.className = POPUP_CLASS;

  if (errorMsg) {
    popup.innerHTML = `
      <div class="rs-popup-header">
        <span class="rs-popup-title">Refine Station</span>
        <button class="rs-popup-close">&times;</button>
      </div>
      <div class="rs-popup-error">${escapeHtml(errorMsg)}</div>
    `;
  } else {
    popup.innerHTML = `
      <div class="rs-popup-header">
        <span class="rs-popup-title">Refine Station</span>
        <button class="rs-popup-close">&times;</button>
      </div>
      <div class="rs-popup-body">${escapeHtml(refinedText)}</div>
      <div class="rs-popup-actions">
        <button class="rs-popup-accept">Accept</button>
        <button class="rs-popup-copy">Copy</button>
        <button class="rs-popup-dismiss">Dismiss</button>
      </div>
    `;

    popup.querySelector(".rs-popup-accept").addEventListener("click", () => {
      setTextToElement(targetEl, refinedText);
      closePopup();
    });

    popup.querySelector(".rs-popup-copy").addEventListener("click", () => {
      navigator.clipboard.writeText(refinedText).catch(() => {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = refinedText;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      });
      const btn = popup.querySelector(".rs-popup-copy");
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });

    popup.querySelector(".rs-popup-dismiss").addEventListener("click", closePopup);
  }

  popup.querySelector(".rs-popup-close").addEventListener("click", closePopup);

  // Position below the target element
  document.body.appendChild(popup);
  const rect = targetEl.getBoundingClientRect();
  popup.style.position = "fixed";
  popup.style.top = `${rect.bottom + 8}px`;
  popup.style.left = `${rect.left}px`;
  popup.style.maxWidth = `${Math.max(rect.width, 350)}px`;
  popup.style.zIndex = "2147483647";

  makeDraggable(popup);
  activePopup = popup;
}

// --- Toggle quick-settings popup ---
async function toggleSettingsPopup(cogBtn) {
  if (activeSettingsPopup) {
    closeSettingsPopup();
    return;
  }

  const settings = await chrome.storage.sync.get({
    tone: "Professional",
    language: "English",
    detail: "Balanced",
  });

  const popup = document.createElement("div");
  popup.className = SETTINGS_POPUP_CLASS;

  popup.innerHTML = `
    <div class="rs-popup-header">
      <span class="rs-popup-title">Quick Settings</span>
      <button class="rs-popup-close">&times;</button>
    </div>
    <div class="rs-settings-body">
      <label for="rs-tone">Tone</label>
      <select id="rs-tone">
        <option value="Friendly">Friendly</option>
        <option value="Casual">Casual</option>
        <option value="Professional">Professional</option>
        <option value="Formal">Formal</option>
        <option value="Strict">Strict</option>
      </select>
      <label for="rs-lang">Language</label>
      <select id="rs-lang">
        <option value="English">English</option>
        <option value="Romanian">Romanian</option>
        <option value="French">French</option>
        <option value="Auto-detect">Auto-detect</option>
      </select>
      <label for="rs-detail">Length</label>
      <select id="rs-detail">
        <option value="Concise">Concise</option>
        <option value="Balanced">Balanced</option>
        <option value="Detailed">Detailed</option>
      </select>
    </div>
  `;

  popup.querySelector(".rs-popup-close").addEventListener("click", closeSettingsPopup);

  const toneSelect = popup.querySelector("#rs-tone");
  const langSelect = popup.querySelector("#rs-lang");
  const detailSelect = popup.querySelector("#rs-detail");
  toneSelect.value = settings.tone;
  langSelect.value = settings.language;
  detailSelect.value = settings.detail;

  toneSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ tone: toneSelect.value });
  });
  langSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ language: langSelect.value });
  });
  detailSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ detail: detailSelect.value });
  });

  document.body.appendChild(popup);

  // Position near the cog button
  const btnRect = cogBtn.getBoundingClientRect();
  popup.style.top = `${btnRect.bottom + 6}px`;
  popup.style.left = `${Math.min(btnRect.left, window.innerWidth - 230)}px`;

  makeDraggable(popup);
  activeSettingsPopup = popup;
}

function closeSettingsPopup() {
  if (activeSettingsPopup) {
    activeSettingsPopup.remove();
    activeSettingsPopup = null;
  }
}

// --- Make a popup draggable by its header ---
function makeDraggable(popup) {
  const header = popup.querySelector(".rs-popup-header");
  if (!header) return;

  let isDragging = false;
  let startX, startY, startLeft, startTop;

  header.addEventListener("mousedown", (e) => {
    // Don't drag when clicking the close button
    if (e.target.closest(".rs-popup-close")) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = popup.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    popup.style.left = `${startLeft + dx}px`;
    popup.style.top = `${startTop + dy}px`;
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
}

function closePopup() {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Scan page for text inputs ---
const TEXT_INPUT_SELECTOR = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""], [role="textbox"]';

function scanPage() {
  document.querySelectorAll(TEXT_INPUT_SELECTOR).forEach(attachToElement);
  // Also catch elements with isContentEditable that don't have the attribute directly
  document.querySelectorAll('[contenteditable] *').forEach((el) => {
    if (el.isContentEditable && !el.dataset.rsAttached) attachToElement(el);
  });
}

// Initial scan + rescan after a short delay for late-loading elements
scanPage();
setTimeout(scanPage, 1500);
setTimeout(scanPage, 5000);

// Watch for dynamically added elements
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (isTextInput(node)) attachToElement(node);
      node.querySelectorAll?.(TEXT_INPUT_SELECTOR).forEach(attachToElement);
    }
    // Also check attribute changes (contenteditable can be set dynamically)
    if (mutation.type === "attributes" && mutation.target.nodeType === 1) {
      if (isTextInput(mutation.target)) attachToElement(mutation.target);
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["contenteditable", "role"] });

// Close popup when clicking outside
document.addEventListener("click", (e) => {
  if (activePopup && !activePopup.contains(e.target) && !e.target.classList.contains(BUTTON_CLASS) && !e.target.classList.contains(TIPS_BUTTON_CLASS)) {
    closePopup();
  }
  if (activeSettingsPopup && !activeSettingsPopup.contains(e.target) && !e.target.classList.contains(COG_BUTTON_CLASS)) {
    closeSettingsPopup();
  }
});

// Close popup on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closePopup();
    closeSettingsPopup();
  }
});
