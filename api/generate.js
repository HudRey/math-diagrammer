// api/generate.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-password");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }
    body = body || {};

    const clientPassword = req.headers["x-app-password"] || req.headers["X-App-Password"];
    const serverPassword = process.env.APP_PASSWORD;

    if (serverPassword && clientPassword !== serverPassword) {
      return res.status(401).json({ error: "Incorrect access password." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not set in Vercel Settings -> Environment Variables." });
    }

    const system = body.system || "";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userPrompt = messages.length > 0 ? messages[messages.length - 1]?.content || "" : "";

    if (!userPrompt) {
      return res.status(400).json({ error: "No prompt text was received." });
    }

    // Modern 3.x series model identifiers
    const models = [
      "gemini-3.6-flash",
      "gemini-3.1-pro-preview"
    ];

    let rawText = null;
    let lastError = null;

    for (const model of models) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey.trim()
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: system }]
            },
            contents: [
              {
                role: "user",
                parts: [{ text: userPrompt }]
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
          break;
        } else {
          lastError = data.error?.message || `Model ${model} failed`;
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    if (!rawText) {
      return res.status(500).json({ error: lastError || "Failed to generate diagram." });
    }

    return res.status(200).json({
      content: [{ type: "text", text: rawText }]
    });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
