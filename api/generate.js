// Next.js App Router (app/api/generate/route.js) or Node Serverless Function
import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { system, messages } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const userPrompt = messages[messages.length - 1]?.content || "";

    // Call Google Gemini API (Free tier: gemini-1.5-flash or gemini-2.0-flash)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
          temperature: 0.1, // Low temperature for maximum geometric precision
          response_mime_type: "application/json" // Guarantees pure JSON output
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: errText }, { status: response.status });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    // Format the response so your existing App.jsx can read it without modification
    return NextResponse.json({
      content: [{ type: "text", text: rawText }]
    });

  } catch (err) {
    console.error("Gemini API Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
