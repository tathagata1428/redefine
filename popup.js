// Load saved settings
chrome.storage.sync.get(
  { apiKey: "", model: "gemini-3.1-flash-lite-preview", tone: "Professional", language: "English", detail: "Balanced", enabled: true },
  (items) => {
    document.getElementById("apiKey").value = items.apiKey;
    document.getElementById("model").value = items.model;
    document.getElementById("tone").value = items.tone;
    document.getElementById("language").value = items.language;
    document.getElementById("detail").value = items.detail;

    const toggle = document.getElementById("enableToggle");
    const statusLabel = document.getElementById("toggleStatus");
    toggle.checked = items.enabled;
    statusLabel.textContent = items.enabled ? "Active on all pages" : "Paused";
  }
);

// Enable/disable toggle
document.getElementById("enableToggle").addEventListener("change", (e) => {
  const enabled = e.target.checked;
  const statusLabel = document.getElementById("toggleStatus");
  statusLabel.textContent = enabled ? "Active on all pages" : "Paused";
  chrome.storage.sync.set({ enabled });

  // Notify all tabs to enable/disable
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: "toggleEnabled", enabled }).catch(() => {});
    }
  });
});

// Save settings
document.getElementById("save").addEventListener("click", () => {
  const settings = {
    apiKey: document.getElementById("apiKey").value.trim(),
    model: document.getElementById("model").value,
    tone: document.getElementById("tone").value,
    language: document.getElementById("language").value,
    detail: document.getElementById("detail").value,
  };

  if (!settings.apiKey) {
    document.getElementById("status").textContent = "Please enter an API key.";
    document.getElementById("status").style.color = "#dc2626";
    return;
  }

  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById("status");
    status.textContent = "Settings saved!";
    status.style.color = "#059669";
    setTimeout(() => (status.textContent = ""), 2000);
  });
});

// --- Writing Tips ---
const writingTips = {
  Friendly: [
    { label: "Warmth", text: "Open with a warm greeting. Use the person's name and ask how they're doing." },
    { label: "Positivity", text: "Frame feedback positively. Say \"You could try...\" instead of \"Don't do...\"." },
    { label: "Emojis", text: "A well-placed emoji can soften your message, but don't overdo it." },
  ],
  Casual: [
    { label: "Keep it short", text: "Get to the point quickly. Casual doesn't mean rambling." },
    { label: "Contractions", text: "Use \"I'm\", \"we'll\", \"don't\" — they sound more natural." },
    { label: "Be direct", text: "Skip formalities. \"Hey, quick question —\" works great." },
  ],
  Professional: [
    { label: "Structure", text: "Lead with the purpose. Use short paragraphs and bullet points for clarity." },
    { label: "Action items", text: "End with a clear next step or call to action." },
    { label: "Proofread", text: "Typos undermine credibility. Always re-read before sending." },
  ],
  Formal: [
    { label: "Salutation", text: "Use \"Dear [Title] [Last Name],\" — never first names unless invited." },
    { label: "Avoid slang", text: "Replace casual phrases: \"ASAP\" → \"at your earliest convenience\"." },
    { label: "Closing", text: "End with \"Kind regards\" or \"Respectfully\" followed by your full name." },
  ],
  Strict: [
    { label: "Precision", text: "Every sentence should serve a purpose. Cut filler words ruthlessly." },
    { label: "Facts first", text: "Lead with data, deadlines, and specifics. Opinions come last." },
    { label: "No ambiguity", text: "Replace \"soon\" with a date. Replace \"some\" with a number." },
  ],
};

const detailTips = {
  Concise: [
    { label: "One idea per sentence", text: "If a sentence has two ideas, split or cut one." },
    { label: "Delete adverbs", text: "Words like \"very\", \"really\", \"actually\" rarely add value." },
  ],
  Balanced: [
    { label: "Context + action", text: "Give just enough background, then state what you need." },
    { label: "Readability", text: "Aim for 2-3 sentence paragraphs. Walls of text get skimmed." },
  ],
  Detailed: [
    { label: "Explain why", text: "Don't just state what — explain the reasoning behind your ask." },
    { label: "Examples", text: "Concrete examples make abstract ideas click faster." },
  ],
};

document.getElementById("tipsBtn").addEventListener("click", () => {
  const tone = document.getElementById("tone").value;
  const detail = document.getElementById("detail").value;
  const tips = [...(writingTips[tone] || writingTips.Professional), ...(detailTips[detail] || detailTips.Balanced)];

  const body = document.getElementById("tipsBody");
  body.innerHTML = tips
    .map((t) => `<div class="tip"><strong>${t.label}</strong><br>${t.text}</div>`)
    .join("");

  document.getElementById("tipsOverlay").classList.add("active");
});

document.getElementById("tipsClose").addEventListener("click", () => {
  document.getElementById("tipsOverlay").classList.remove("active");
});

document.getElementById("tipsOverlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove("active");
  }
});
