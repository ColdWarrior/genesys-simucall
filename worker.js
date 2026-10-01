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

    const url = new URL(request.url);
	const pathname = url.pathname.replace(/\/+/g, "/"); // Normalizes "//api" to "/api"

    // Endpoint 1: Generate AI Customer Response
    if (url.pathname === "/api/generate-response" && request.method === "POST") {
      try {
        const { systemPrompt, conversationHistory, latestAgentMessage } = await request.json();

        const contents = conversationHistory.map(msg => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }]
        }));

        contents.push({
          role: "user",
          parts: [{ text: `Agent: ${latestAgentMessage}` }]
        });

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;

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
        const customerReply = data.candidates[0].content.parts[0].text;

        return new Response(JSON.stringify({ reply: customerReply }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // Endpoint 2: Generate QA Evaluation Scorecard (JSON Mode)
    if (url.pathname === "/api/evaluate-call" && request.method === "POST") {
      try {
        const { transcript } = await request.json();

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
${transcript.map(t => `${t.sender}:${t.text}`).join("\n")}
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
        const scorecardJson = evalData.candidates[0].content.parts[0].text;

        return new Response(scorecardJson, {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    return new Response("SimuCall AI Cloudflare Worker Active", { status: 200 });
  }
};