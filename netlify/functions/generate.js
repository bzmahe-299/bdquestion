// netlify/functions/generate.js
// Gemini দিয়ে প্রশ্ন বানায়। API key কোডে নেই, Netlify-এর GEMINI_API_KEY থেকে আসে।
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const reply = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
const s = (x) => (typeof x === "string" ? x.trim() : "");

function prompt(a) {
  const lang = a.lang === "English" ? "English" : "Bengali (use Bengali script)";
  const need = Math.max(1, Math.min(10, parseInt(a.need, 10) || 1));
  const raw = String(a.stem || "");
  const cut = raw.indexOf("\n\n");
  const head = cut > -1 ? raw.slice(0, cut) : "";
  const body = cut > -1 ? raw.slice(cut + 2) : raw;
  const avoid = (a.avoid || []).slice(-60).map((x, i) => (i + 1) + ". " + String(x).slice(0, 100)).join("\n");
  let spec;
  if (a.type === "creative") {
    spec = 'Create ' + need + ' Bangladeshi creative question(s) (সৃজনশীল). Each has a stimulus "stem", then four parts: ' +
      'k = knowledge (1 mark), kh = comprehension (2 marks), g = application (3 marks), gh = higher-order skill (4 marks). ' +
      'ak, akh, ag, agh are short model answers for k, kh, g, gh. ' +
      (a.auto
        ? "Write a fresh stimulus yourself from the topic below. "
        : (a.first
            ? "For the FIRST question use the teacher's stimulus below word-for-word as stem. "
            : "Write a NEW stimulus on the same subject and chapter as the teacher's text below. ")) +
      'Return JSON: {"items":[{"stem":"","k":"","kh":"","g":"","gh":"","ak":"","akh":"","ag":"","agh":""}]}';
  } else if (a.type === "short") {
    spec = "Create " + need + " short-answer questions with correct answers. " +
      'Return JSON: {"items":[{"q":"","a":""}]}';
  } else {
    spec = "Create " + need + " multiple-choice questions, exactly 4 options each, one correct. " +
      '"answer" is the index (0-3) of the correct option. Options must not start with letters or numbers. ' +
      'Return JSON: {"items":[{"q":"","options":["","","",""],"answer":0}]}';
  }
  return spec + "\nLanguage: " + lang + ".\nReturn ONLY valid JSON, no extra text.\n" +
    "Exam: " + s(a.name) + "\n" + head + "\nTopic / material:\n" + body +
    (avoid ? "\n\nDo NOT repeat or closely copy these earlier questions:\n" + avoid : "");
}

function clean(type, arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    if (type === "creative") {
      const o = { stem: s(x.stem), k: s(x.k), kh: s(x.kh), g: s(x.g), gh: s(x.gh),
        ak: s(x.ak), akh: s(x.akh), ag: s(x.ag), agh: s(x.agh) };
      if (o.stem && o.k && o.kh && o.g && o.gh) out.push(o);
    } else if (type === "short") {
      if (s(x.q)) out.push({ q: s(x.q), a: s(x.a) });
    } else {
      const opts = Array.isArray(x.options) ? x.options.map(s) : [];
      const ans = parseInt(x.answer, 10);
      if (s(x.q) && opts.length === 4 && opts.every(Boolean) && ans >= 0 && ans <= 3)
        out.push({ q: s(x.q), options: opts, answer: ans });
    }
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "POST লাগবে" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return reply(500, { error: "Netlify-তে GEMINI_API_KEY সেট করা নেই" });
  let a;
  try { a = JSON.parse(event.body || "{}"); } catch (e) { return reply(400, { error: "ভুল অনুরোধ" }); }
  const type = ["mcq", "short", "creative"].includes(a.type) ? a.type : "mcq";
  a.type = type;
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt(a) }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.7, maxOutputTokens: 8192 },
        }),
      }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = r.status === 429 || r.status === 503 ? r.status : 500;
      return reply(code, { error: (j.error && j.error.message) || ("Gemini HTTP " + r.status) });
    }
    let t = (((j.candidates || [])[0] || {}).content || {}).parts;
    t = Array.isArray(t) ? t.map((p) => p.text || "").join("") : "";
    t = t.replace(/^```json\s*|^```\s*|```\s*$/g, "").trim();
    let data;
    try { data = JSON.parse(t); } catch (e) { return reply(502, { error: "মডেল ঠিক ফরম্যাটে উত্তর দেয়নি" }); }
    return reply(200, { items: clean(type, Array.isArray(data) ? data : data.items) });
  } catch (e) {
    return reply(500, { error: String(e.message || e) });
  }
};
