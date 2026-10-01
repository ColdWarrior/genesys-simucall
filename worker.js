export default {
  async fetch(request, env, ctx) {
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

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+/g, "/");

    if (pathname === "/favicon.ico") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    async function callGeminiWithFallback(payload) {
      const models = [
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash"
      ];

      let lastError = "Gemini API request failed.";

      for (const model of models) {
        // Standard endpoint with location hints
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
        
        try {
          const res = await fetch(geminiUrl, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              // Removes internal proxy forwarding IPs that trigger regional blocking
              "X-Forwarded-For": "" 
            },
            body: JSON.stringify(payload),
            // Cloudflare Workers fetch configuration option to prefer global edge routing
            cf: {
              cacheEverything: false
            }
          });

          const data = await res.json();

          if (res.ok) {
            return { success: true, data };
          }

          lastError = data.error?.message || `Model ${model} error`;
          
          if (res.status === 429 || res.status === 404 || res.status === 503 || res.status === 500 || lastError.includes("not found") || lastError.includes("high demand") || lastError.includes("location")) {
            console.warn(`Model ${model} returned error (${lastError}). Retrying...`);
            continue;
          }

          return { success: false, error: lastError, status: res.status };
        } catch (err) {
          lastError = err.message;
        }
      }

      return { success: false, error: lastError, status: 503 };
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

        const contents = [];

        if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
          conversationHistory.forEach(msg => {
            contents.push({
              role: msg.role === "assistant" ? "model" : "user",
              parts: [{ text: msg.content || "" }]
            });
          });
        }

        contents.push({
          role: "user",
          parts: [{ text: latestAgentMessage }]
        });

        if (contents.length > 0 && contents[0].role === "model") {
          contents.unshift({
            role: "user",
            parts: [{ text: "Context: Customer service call initiated." }]
          });
        }

        const payload = {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 150 }
        };

        const result = await callGeminiWithFallback(payload);

        if (!result.success) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: result.status || 500,
            headers: corsHeaders
          });
        }

        const customerReply = result.data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";

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

        const payload = {
          contents: [{ parts: [{ text: evalPrompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        };

        const result = await callGeminiWithFallback(payload);

        if (!result.success) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: result.status || 500,
            headers: corsHeaders
          });
        }

        const scorecardJson = result.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

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

    return new Response("SimuCall AI Cloudflare Worker Active", {
      status: 200,
      headers: corsHeaders
    });
  }
};