exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { statusCode: 500, body: JSON.stringify({ error: "GEMINI_API_KEY missing" }) };
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  let b;
  try { b = JSON.parse(event.body); } catch { return { statusCode: 400, body: "bad json" }; }
  const { name = "", stem = "", lang = "Bengali", need = 8, avoid = [], type = "mcq", auto = false, first = false } = b;
  let prompt;
  if (type === "creative") {
    prompt =
      "You are an exam paper setter for Bangladesh school-level creative questions (srijonshil proshno, NCTB style). Create exactly " + need +
      " creative questions in " + lang + " for the exam \"" + name + "\". Each question has a stimulus (a short passage, scenario, data or situation of 3 to 6 sentences) followed by four parts: " +
      "k = knowledge-based question (1 mark), kh = comprehension question (2 marks), g = application question (3 marks) that applies the stimulus, " +
      "gh = higher-order thinking question (4 marks) needing analysis or judgement. The four parts must relate to the stimulus and increase in difficulty. " +
      "Also write a correct model answer for each part: ak (1 sentence), akh (2 to 3 sentences), ag (3 to 5 sentences), agh (5 to 8 sentences). " +
      "Return ONLY a JSON array: [{\"stem\":\"...\",\"k\":\"...\",\"kh\":\"...\",\"g\":\"...\",\"gh\":\"...\",\"ak\":\"...\",\"akh\":\"...\",\"ag\":\"...\",\"agh\":\"...\"}]." +
      (auto
        ? " Invent a fresh stimulus for every question based on the topic below."
        : first
          ? " Use the text below, word for word, as the stimulus of the FIRST question; any other questions need new stimuli on the same topic."
          : " Invent new stimuli on the same topic as the text below.") +
      (avoid.length ? "\nDo not repeat or closely resemble these existing stimuli:\n" + avoid.join("\n") : "") +
      "\n\nTopic or stimulus text:\n" + stem;
  } else if (type === "short") {
    prompt =
      "You are an exam paper setter. Create exactly " + need + " short-answer questions (sonkhipto proshno) in " + lang +
      " for the exam \"" + name + "\", based on the following topic or text. Each question must be answerable in 1 to 3 sentences, be clear and accurate, and cover different aspects. " +
      "Also write a correct model answer (1 to 3 sentences) for each. " +
      "Return ONLY a JSON array: [{\"q\":\"...\",\"a\":\"...\"}]." +
      (avoid.length ? "\nDo not repeat or closely resemble these existing questions:\n" + avoid.join("\n") : "") +
      "\n\nTopic or text:\n" + stem;
  } else {
    prompt =
      "You are an exam paper setter. Create exactly " + need + " multiple choice questions in " + lang +
      " for the exam \"" + name + "\", based on the following creative-question stem, passage or topic. " +
      "Questions must be clear, accurate, cover different aspects and range from easy to hard. " +
      "Each has exactly 4 options and exactly one correct answer; vary the correct position. " +
      "Do not put option letters inside the option text. " +
      "Return ONLY a JSON array: [{\"q\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],\"answer\":0}] " +
      "where answer is the 0-based index of the correct option." +
      (avoid.length ? "\nDo not repeat or closely resemble these existing questions:\n" + avoid.join("\n") : "") +
      "\n\nStem:\n" + stem;
  }
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
        }),
      }
    );
    if (!r.ok) return { statusCode: r.status, body: JSON.stringify({ error: await r.text() }) };
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const arr = JSON.parse(text.replace(/```json|```/g, "").trim());
    const items = type === "creative"
      ? arr.filter((x) => x && x.stem && x.k && x.kh && x.g && x.gh && x.ak && x.akh && x.ag && x.agh)
      : type === "short"
      ? arr.filter((x) => x && x.q && x.a)
      : arr.filter(
          (x) => x && x.q && Array.isArray(x.options) && x.options.length === 4 &&
            Number.isInteger(x.answer) && x.answer >= 0 && x.answer < 4
        );
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
