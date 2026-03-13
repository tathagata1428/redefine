// Service worker — handles Gemini API calls from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "refine") {
    refineText(request.text, request.tone, request.language, request.detail)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.action === "tips") {
    getWritingTips(request.text)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function refineText(text, tone, language, detail) {
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  if (!apiKey) {
    throw new Error("API key not set — click the Refine Station extension icon to configure it.");
  }

  const { model } = await chrome.storage.sync.get({ model: "gemini-3.1-flash-lite-preview" });

  const detailInstructions = {
    Concise: "Make the text shorter and more to the point. Remove unnecessary words and filler.",
    Balanced: "Keep a similar length. Improve clarity and flow without making it longer or shorter.",
    Detailed: "Expand on the ideas. Add more context and detail while keeping the same meaning.",
  };

  const systemPrompt = `You are an expert writing assistant. Rewrite the user's text to be clearer, more professional, and well-structured. Keep the same meaning and intent. ${detailInstructions[detail] || detailInstructions.Balanced} Respond with ONLY the improved text — no explanations, no quotes, no markdown.`;

  const userPrompt =
    `Rewrite the following text.\nTone: ${tone}\nLanguage: ${language}\nDetail: ${detail}\n\nOriginal:\n${text}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const refined =
    data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!refined) throw new Error("Empty response from Gemini");
  return refined.trim();
}

async function getWritingTips(text) {
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  if (!apiKey) {
    throw new Error("API key not set — click the Refine Station extension icon to configure it.");
  }

  const { model } = await chrome.storage.sync.get({ model: "gemini-3.1-flash-lite-preview" });

  const systemPrompt = `You are an expert writing coach. Analyze the user's text and provide personalized, dynamic writing feedback.

Return ONLY a valid JSON array of tip objects. No markdown, no explanation, just the JSON array.

Each tip object must have:
- "type": one of "strength", "warning", or "suggestion"
- "title": short title (5-8 words max)
- "detail": specific, actionable feedback (1-2 sentences) referencing the actual text

Provide 4-6 tips total. Include at least one "strength" (what they did well). Focus on:
- Clarity and conciseness
- Tone and word choice
- Structure and flow
- Grammar and punctuation
- Impact and persuasiveness

Be specific — reference actual phrases or patterns from the text. Avoid generic advice.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: `Analyze this text and give writing tips:\n\n${text}` }] }],
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  let raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!raw) throw new Error("Empty response from Gemini");

  // Strip markdown fences if present
  raw = raw.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
  }

  // Extract JSON array
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      // fall through
    }
  }

  return [{ type: "suggestion", title: "Analysis", detail: raw }];
}
