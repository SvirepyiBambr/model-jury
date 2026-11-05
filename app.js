// Model Jury — ask one question, let several Pollinations text models vote independently.
// Every juror is a separate POST to gen.pollinations.ai/v1/chat/completions with the visitor's key.
const API = "https://gen.pollinations.ai";
const MODELS = [
    { id: "openai/gpt-5.4-nano", label: "GPT-5.4 nano" },
    { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
    { id: "x-ai/grok-4.6", label: "Grok 4.6" },
    { id: "mistralai/mistral-large-3", label: "Mistral Large 3" },
    { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini" },
    { id: "nvidia/nemotron-3.5-lightning", label: "Nemotron 3.5 Lightning" },
    { id: "qwen/qwen3.8-2.4t-a95b", label: "Qwen 3.8" },
    { id: "minimax/minimax-m3.1-flash", label: "MiniMax M3.1 Flash" },
];
const DEFAULT_PICKS = ["openai/gpt-5.4-nano", "deepseek/deepseek-v4.1-flash", "x-ai/grok-4.6", "mistralai/mistral-large-3", "meta/llama-3.3-70b-instruct"];
const SYSTEM = 'You are a juror in a public debate. Commit to a side: answer YES or NO, even if the topic is nuanced. '
    + 'Use UNCLEAR only when the question is nonsensical or impossible to answer. '
    + 'Reply with STRICT JSON only, no markdown: {"verdict":"YES"|"NO"|"UNCLEAR","reason":"one concrete sentence, max 25 words"}.';

const $ = (id) => document.getElementById(id);
const keyEl = $("key");
const questionEl = $("question");
const modelsEl = $("models");
const askBtn = $("ask");

keyEl.value = localStorage.getItem("polli_key") || "";
keyEl.addEventListener("change", () => localStorage.setItem("polli_key", keyEl.value.trim()));

function renderChips() {
    modelsEl.innerHTML = "";
    for (const m of MODELS) {
        const label = document.createElement("label");
        label.className = "chip" + (DEFAULT_PICKS.includes(m.id) ? " on" : "");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = m.id;
        cb.checked = DEFAULT_PICKS.includes(m.id);
        cb.addEventListener("change", () => {
            label.classList.toggle("on", cb.checked);
            updateCount();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(m.label));
        modelsEl.appendChild(label);
    }
    updateCount();
}
function picked() {
    return [...modelsEl.querySelectorAll("input:checked")].map((c) => c.value);
}
function updateCount() {
    $("pickCount").textContent = `(${picked().length} selected)`;
}

function parseVerdict(text) {
    if (!text) return { verdict: "UNCLEAR", reason: "Empty answer." };
    const cleaned = text.replace(/```json|```/g, "").trim();
    try {
        const o = JSON.parse(cleaned);
        const v = String(o.verdict || "").toUpperCase();
        return { verdict: ["YES", "NO", "UNCLEAR"].includes(v) ? v : "UNCLEAR", reason: String(o.reason || "").slice(0, 240) };
    } catch {
        const v = /\bYES\b/i.test(cleaned) ? "YES" : /\bNO\b/i.test(cleaned) ? "NO" : "UNCLEAR";
        return { verdict: v, reason: cleaned.replace(/\s+/g, " ").slice(0, 200) };
    }
}

async function askOne(model, question, key) {
    const started = performance.now();
    const res = await fetch(API + "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: SYSTEM },
                { role: "user", content: question },
            ],
            temperature: 0.4,
            max_tokens: 220,
        }),
    });
    if (!res.ok) {
        const body = (await res.text()).slice(0, 160);
        throw new Error(`${res.status}: ${body}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    return { model, ...parseVerdict(text), ms: Math.round(performance.now() - started) };
}

function renderVerdicts(rows) {
    const counts = { YES: 0, NO: 0, UNCLEAR: 0 };
    for (const r of rows) counts[r.verdict]++;
    const total = rows.length || 1;
    const bar = $("bar");
    bar.innerHTML = "";
    for (const k of ["YES", "NO", "UNCLEAR"]) {
        if (!counts[k]) continue;
        const seg = document.createElement("div");
        seg.className = "seg " + k.toLowerCase();
        seg.style.width = (100 * counts[k] / total) + "%";
        seg.textContent = `${k} ${counts[k]}`;
        bar.appendChild(seg);
    }
    const majority = counts.YES === counts.NO ? null : (counts.YES > counts.NO ? "YES" : "NO");
    $("consensus").textContent = counts.YES === counts.NO
        ? `Split jury: ${counts.YES}–${counts.NO}${counts.UNCLEAR ? ` (${counts.UNCLEAR} undecided)` : ""}.`
        : `The jury leans ${majority}: ${Math.max(counts.YES, counts.NO)} of ${total}${counts.UNCLEAR ? `, ${counts.UNCLEAR} undecided` : ""}.`;

    const cards = $("cards");
    cards.innerHTML = "";
    for (const r of rows) {
        const meta = MODELS.find((m) => m.id === r.model);
        const card = document.createElement("article");
        card.className = "card";
        card.innerHTML = `<div class="head"><span class="model">${meta ? meta.label : r.model}</span>
            <span class="badge ${r.verdict}">${r.verdict}</span></div>
            <p class="reason"></p><div class="meta">${r.ms} ms · ${r.model}</div>`;
        card.querySelector(".reason").textContent = r.reason;
        cards.appendChild(card);
    }
    $("result").hidden = false;
}

async function run() {
    const question = questionEl.value.trim();
    const key = keyEl.value.trim();
    const models = picked();
    $("error").hidden = true;
    if (!question) return showError("Type a question first.");
    if (!key) return showError("Paste your Pollinations key (sk_...) — the jury calls the API with your own key.");
    if (!models.length) return showError("Pick at least one model.");

    localStorage.setItem("polli_key", key);
    askBtn.disabled = true;
    askBtn.innerHTML = '<span class="spin"></span>Deliberating…';
    $("result").hidden = true;

    const settled = await Promise.allSettled(models.map((m) => askOne(m, question, key)));
    const rows = [];
    const errors = [];
    settled.forEach((s, i) => {
        if (s.status === "fulfilled") rows.push(s.value);
        else errors.push(`${models[i]} → ${s.reason?.message || s.reason}`);
    });
    askBtn.disabled = false;
    askBtn.textContent = "Convene the jury";

    if (rows.length) renderVerdicts(rows);
    if (errors.length) showError("Some jurors failed:\n" + errors.join("\n"));
}

function showError(text) {
    $("error").textContent = text;
    $("error").hidden = false;
}

askBtn.addEventListener("click", run);
renderChips();
