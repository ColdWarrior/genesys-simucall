export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS preflight options request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const corsHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    };

    // 2. Parse URL and normalize double slashes (e.g. //api -> /api)
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+/g, "/");

    // 3. Silently handle browser favicon requests
    if (pathname === "/favicon.ico") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Route 1: Generate AI Customer Response
    if (pathname === "/api/generate-response" && request.method === "POST") {
      try {
        if (!env.GEMINI_API_KEY) {
          return new Response(JSON.stringify({ error: "GEMINI_API_KEY secret environment variable is missing." }), {
            status: 500,
            headers: corsHeaders
          });
        }

        let body;
        try {
          body = await request.json();
        } catch (e) {
          return new Response(JSON.stringify({ error: "Invalid JSON body provided in request." }), {
            status: 400,
            headers: corsHeaders
          });
        }

        const { systemPrompt = "", conversationHistory = [], latestAgentMessage = "" } = body;

        // Construct Gemini contents payload
        const contents = [];

        // Map existing transcript history
        if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
          conversationHistory.forEach(msg => {
            contents.push({
              role: msg.role === "assistant" ? "model" : "user",
              parts: [{ text: msg.content || "" }]
            });
          });
        }

        // Add latest agent message
        contents.push({
          role: "user",
          parts: [{ text: latestAgentMessage }]
        });

        // Gemini REST API strictly requires contents to start with role: 'user'
        if (contents.length > 0 && contents[0].role === "model") {
          contents.unshift({
            role: "user",
            parts: [{ text: "Context: Customer service call initiated." }]
          });
        }

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;

        const geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 150 }
          })
        });

        const data = await geminiResponse.json();

        if (!geminiResponse.ok) {
          return new Response(JSON.stringify({ error: data.error?.message || "Gemini API request failed." }), {
            status: geminiResponse.status,
            headers: corsHeaders
          });
        }

        const customerReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";

        return new Response(JSON.stringify({ reply: customerReply, response: customerReply }), {
          status: 200,
          headers: corsHeaders
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || "Internal Worker Error" }), {
          status: 500,
          headers: corsHeaders
        });
      }
    }

    // Route 2: Generate QA Evaluation Scorecard
    if (pathname === "/api/evaluate-call" && request.method === "POST") {
      try {
        if (!env.GEMINI_API_KEY) {
          return new Response(JSON.stringify({ error: "GEMINI_API_KEY secret environment variable is missing." }), {
            status: 500,
            headers: corsHeaders
          });
        }

        let body;
        try {
          body = await request.json();
        } catch (e) {
          return new Response(JSON.stringify({ error: "Invalid JSON body provided in request." }), {
            status: 400,
            headers: corsHeaders
          });
        }

        const { transcript = [] } = body;

        const evalPrompt = `
Analyze the following contact center chat transcript between a Trainee Agent and a Customer.
Evaluate the agent on a 1-5 scale across:
1. Empathy & Tone
2. Protocol Compliance (asking for pin/verification before sharing account data)
3. Problem Resolution

Return STRICT JSON matching this structure:
{
  "scores": { "empathy": 4, "protocol": 5, "resolution": 3 },
  "summary": "Short overall performance summary...",
  "coaching_tip": "One key improvement area..."
}

TRANSCRIPT:
${(transcript || []).map(t => `${t.sender}:${t.text}`).join("\n")}
`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;

        const geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: evalPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        });

        const evalData = await geminiResponse.json();

        if (!geminiResponse.ok) {
          return new Response(JSON.stringify({ error: evalData.error?.message || "Gemini API request failed." }), {
            status: geminiResponse.status,
            headers: corsHeaders
          });
        }

        const scorecardJson = evalData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

        return new Response(scorecardJson, {
          status: 200,
          headers: corsHeaders
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || "Internal Worker Error" }), {
          status: 500,
          headers: corsHeaders
        });
      }
    }

    // Fallback health check
    return new Response("SimuCall AI Cloudflare Worker Active", {
      status: 200,
      headers: corsHeaders
    });
  }
};