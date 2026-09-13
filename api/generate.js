async function generate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);

    // 1. Get or prompt for API key
    let apiKey = localStorage.getItem("gemini_api_key");
    if (!apiKey) {
      apiKey = window.prompt("Enter your free Google Gemini API Key from aistudio.google.com:");
      if (!apiKey) {
        setLoading(false);
        return;
      }
      localStorage.setItem("gemini_api_key", apiKey.trim());
    }

    try {
      let userMsg = prompt.trim();
      const cur = sceneRef.current;
      if (cur.shapes.length || (cur.marks || []).length || cur.annotations.length) {
        userMsg = `Current diagram: ${JSON.stringify(cur)}\n\nRequest: ${prompt.trim()}`;
      }

      // Try gemini-2.5-flash first, fall back to gemini-2.0-flash if needed
      const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
      let rawText = null;
      let lastError = null;

      for (const model of models) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

          const response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: SYSTEM_PROMPT }]
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: userMsg }]
                }
              ],
              generationConfig: {
                temperature: 0.1,
                response_mime_type: "application/json"
              }
            })
          });

          const data = await response.json();

          if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
            rawText = data.candidates[0].content.parts[0].text;
            break; // Success!
          } else if (response.status === 400 || response.status === 403) {
            localStorage.removeItem("gemini_api_key");
            throw new Error("Invalid Gemini API Key. Please refresh and enter a valid key from aistudio.google.com.");
          } else {
            lastError = data.error?.message || "Model error";
          }
        } catch (err) {
          lastError = err.message;
        }
      }

      if (!rawText) {
        throw new Error(lastError || "Could not generate diagram with available Gemini models.");
      }

      const jsonStr = rawText.slice(rawText.indexOf("{"), rawText.lastIndexOf("}") + 1);
      const parsed = JSON.parse(jsonStr);

      pushHistory(sceneRef.current);
      setScene(normalizeScene(parsed));
      setSelectedId(null);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to generate diagram.");
    }
    setLoading(false);
  }
