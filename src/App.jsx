import { useState, useEffect, useRef, useCallback } from "react";

const DRUG_LIST = [
  "Timolol XE",
  "Timolol 0.5%",
  "Xalatan",
  "Lumigan",
  "Lumigan PF",
  "Travatan",
  "Xalacom",
  "DuoTrav",
  "Ganfort",
  "Ganfort PF",
  "Azopt",
  "Cosopt",
  "Azarga",
  "Trusopt",
  "Alphagan",
  "Alphagan P",
  "Simbrinza",
  "Combigan",
  "Pilocarpine 1%",
  "Pilocarpine 2%",
  "Pilocarpine 4%",
  "Iopidine 0.5%",
  "Betoptic 0.5%",
  "Diamox",
  "FML",
  "Maxidex",
  "Prednefrin Forte",
  "Acular",
  "Ilevro",
  "G. Chlorsig",
  "Oc. Chlorsig",
  "Oc. Hycor 1%",
  "Doxycycline",
  "G. Ofloxacin",
  "G. Ciprofloxacin",
  "G. Tobrex",
  "Oc. Tobrex",
  "PAA Eye Gel 10g",
  "Poly-Tears",
  "Hylo Fresh",
  "Hylo Forte",
  "Cationorm",
  "Nova Tears",
  "Systane",
  "Systane UD",
  "Patanol",
  "Mitomycin C 0.2 mg/ml",
  "Mitomycin C 0.4 mg/ml",
];

const EYE_OPTIONS = ["Right eye", "Left eye", "Both eyes"];
const FREQ_OPTIONS = ["daily", "bd", "tds", "qid", "6x/day", "mane", "nocte"];
const REPEAT_OPTIONS = ["No repeats", "Rpt x1", "Rpt x2", "Rpt x5"];
const DURATION_OPTIONS = [
  "For 3 days",
  "For 5 days",
  "For 1 week",
  "For 2 weeks",
  "For 4 weeks",
];

// ─── Levenshtein / fuzzy ─────────────────────────────────────────────────────
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

function fuzzyMatch(word, candidates, threshold = 0.55) {
  const w = word.toLowerCase().replace(/[^a-z0-9.%]/g, "");
  let best = null,
    bestScore = -1;
  for (const c of candidates) {
    const cn = c.toLowerCase().replace(/[^a-z0-9.%]/g, "");
    if (!cn.length) continue;
    const score = 1 - levenshtein(w, cn) / Math.max(w.length, cn.length);
    const final = Math.min(1, score + (cn.startsWith(w) ? 0.2 : 0));
    if (final > bestScore) {
      bestScore = final;
      best = c;
    }
  }
  return { hit: bestScore >= threshold ? best : null, score: bestScore >= threshold ? bestScore : 0 };
}

function applyCustomDictionary(text) {
  const tokens = text.split(/\s+/);
  const out = [];
  let i = 0;
  const PROTECTED = [
    "right",
    "left",
    "both",
    "eye",
    "eyes",
    "bd",
    "tds",
    "qid",
    "daily",
    "mane",
    "nocte",
  ];

  const getBestMatch = (startIdx) => {
    let bestMatch = null;
    let bestLen = 0;
    let maxScore = -1;

    for (let len = 1; len <= Math.min(4, tokens.length - startIdx); len++) {
      const slice = tokens.slice(startIdx, startIdx + len);
      const phrase = slice.join(" ");

      const { hit, score } = fuzzyMatch(phrase, DRUG_LIST, len > 1 ? 0.6 : 0.55);

      if (hit) {
        // 🚨 NEW LOGIC: don't swallow medical keywords
        if (len > 1) {
          const extraWords = slice.slice(1).map((w) => w.toLowerCase());
          const hasProtectedWord = extraWords.some((w) =>
            PROTECTED.includes(w),
          );
          if (hasProtectedWord) continue;
        }

        if (score > maxScore || (score === maxScore && len < bestLen)) {
          maxScore = score;
          bestMatch = hit;
          bestLen = len;
        }
      }
    }
    return { hit: bestMatch, len: bestLen, score: maxScore };
  };

  while (i < tokens.length) {
    const current = getBestMatch(i);

    if (current.hit) {
      let skipCurrent = false;
      if (i + 1 < tokens.length) {
        const next = getBestMatch(i + 1);
        if (
          next.hit &&
          (next.score > current.score ||
            (next.score === current.score && next.len < current.len))
        ) {
          skipCurrent = true;
        }
      }

      if (skipCurrent) {
        out.push(tokens[i]);
        i++;
      } else {
        out.push(current.hit);
        i += current.len;
      }
    } else {
      out.push(tokens[i]);
      i++;
    }
  }
  return out.join(" ");
}

// ─── Eye parser — STRICT clinical phrases only ───────────────────────────────
// Requires "right/left/both" to be immediately followed by "eye(s)",
// or the standalone Latin abbreviations OD / OS / OU as whole words.
// A bare "left" or "right" without "eye" will NOT match.
function parseEye(segment) {
  const text = segment.toLowerCase();

  // Both eyes
  if (/\bboth\s*(eye[s]?|i)?\b/.test(text)) return "Both eyes";

  // Right eye
  if (/\bright\s*(eye[s]?|i)?\b/.test(text)) return "Right eye";

  // Left eye
  if (/\bleft\s*(eye[s]?|i)?\b/.test(text)) return "Left eye";

  return "";
}

// ─── Main transcript parser ───────────────────────────────────────────────────
function parseTranscript(text) {
  const lower = text.toLowerCase();
  const mentions = [];
  DRUG_LIST.forEach((drug) => {
    const idx = lower.indexOf(drug.toLowerCase());
    if (idx !== -1) mentions.push({ drug, idx });
  });
  mentions.sort((a, b) => a.idx - b.idx);
  if (!mentions.length) return [];

  return mentions.slice(0, 3).map((m, d) => {
    const start = m.idx;
    const end = d < mentions.length - 1 ? mentions[d + 1].idx : text.length;
    const segment = text.slice(start, end).toLowerCase();

    const eye = parseEye(segment);

    let frequency = "";
    if (segment.includes("night")) frequency = "nocte";
    else if (segment.includes("morning")) frequency = "mane";
    else if (/6\s*x\b|six\s+times?\s*(a\s+)?day/.test(segment))
      frequency = "6x/day";
    else if (/\bqid\b|four\s+times/.test(segment)) frequency = "qid";
    else if (/\btds\b|three\s+times/.test(segment)) frequency = "tds";
    else if (/\bbd\b|twice\b|two\s+times/.test(segment)) frequency = "bd";
    else if (/\bdaily\b|\bonce\s+a\s+day\b|\bonce\s+daily\b/.test(segment))
      frequency = "daily";

    let repeats = "";
    if (/no\s+repeat|no\s+rpt/.test(segment)) repeats = "No repeats";
    else if (/rpt\s*x?\s*5\b|repeat\s*x?\s*5\b|five\s+repeat/.test(segment))
      repeats = "Rpt x5";
    else if (/rpt\s*x?\s*2\b|repeat\s*x?\s*2\b|two\s+repeat/.test(segment))
      repeats = "Rpt x2";
    else if (/rpt\s*x?\s*1\b|repeat\s*x?\s*1\b|one\s+repeat/.test(segment))
      repeats = "Rpt x1";

    let duration = "";
    if (/\b4\s+weeks?\b|four\s+weeks?/.test(segment)) duration = "For 4 weeks";
    else if (/\b2\s+weeks?\b|two\s+weeks?/.test(segment))
      duration = "For 2 weeks";
    else if (/\b1\s+week\b|one\s+week/.test(segment)) duration = "For 1 week";
    else if (/\b5\s+days?\b|five\s+days?/.test(segment))
      duration = "For 5 days";
    else if (/\b3\s+days?\b|three\s+days?/.test(segment))
      duration = "For 3 days";

    return { drug: m.drug, eye, frequency, repeats, duration };
  });
}

// ─── UI ───────────────────────────────────────────────────────────────────────
const QUICK_EYE = [
  { label: "R", value: "Right eye" },
  { label: "L", value: "Left eye" },
  { label: "B", value: "Both eyes" },
];
const QUICK_FREQ = ["1", "2", "3", "4", "6", "m", "n"];
const QUICK_REPEAT = ["0", "1", "2", "5"];
const FREQ_MAP = {
  1: "daily",
  2: "bd",
  3: "tds",
  4: "qid",
  6: "6x/day",
  m: "mane",
  n: "nocte",
};
const REPEAT_MAP = { 0: "No repeats", 1: "Rpt x1", 2: "Rpt x2", 5: "Rpt x5" };

function SearchDropdown({ placeholder, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef();
  useEffect(() => {
    const h = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered = options.filter((o) =>
    o.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: "1px solid",
          borderColor: open ? "#3b82f6" : value ? "#3b82f6" : "#c8d0d8",
          borderRadius: 4,
          padding: "6px 10px",
          fontSize: 13,
          color: "#333",
          outline: "none",
          background: value ? "#f0f7ff" : "#fff",
          transition: "border-color 0.15s",
        }}
        placeholder={placeholder}
        value={value || query}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onChange("");
        }}
      />
      {open && filtered.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 999,
            background: "#fff",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {filtered.map((o) => (
            <div
              key={o}
              onMouseDown={() => {
                onChange(o);
                setQuery("");
                setOpen(false);
              }}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                cursor: "pointer",
                color: "#222",
                background: o === value ? "#eff6ff" : "transparent",
                borderBottom: "1px solid #f3f4f6",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#f0f9ff")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background =
                  o === value ? "#eff6ff" : "transparent")
              }
            >
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        border: "1px solid",
        borderColor: active ? "#3b82f6" : "#c8d0d8",
        background: active ? "#3b82f6" : "#fff",
        color: active ? "#fff" : "#555",
        fontSize: 12,
        cursor: "pointer",
        fontWeight: active ? 700 : 400,
        transition: "all 0.15s",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {label}
    </button>
  );
}

function DrugColumn({ idx, data, onChange, highlight }) {
  const set = (f) => (v) => onChange(idx, f, v);
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: "0 6px",
        animation: highlight ? "flashCol 0.6s ease" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 11, color: "#64748b" }}>👁</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
          Drug {idx + 1}
        </span>
      </div>
      <SearchDropdown
        placeholder="Search drugs..."
        options={DRUG_LIST}
        value={data.drug}
        onChange={set("drug")}
      />
      <Label>Eye</Label>
      <SearchDropdown
        placeholder="Search eye/route..."
        options={EYE_OPTIONS}
        value={data.eye}
        onChange={set("eye")}
      />
      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
        {QUICK_EYE.map(({ label, value }) => (
          <QuickButton
            key={label}
            label={label}
            active={data.eye === value}
            onClick={() => set("eye")(data.eye === value ? "" : value)}
          />
        ))}
      </div>
      <Label>Frequency</Label>
      <SearchDropdown
        placeholder="Search frequencies..."
        options={FREQ_OPTIONS}
        value={data.frequency}
        onChange={set("frequency")}
      />
      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
        {QUICK_FREQ.map((k) => (
          <QuickButton
            key={k}
            label={k}
            active={data.frequency === FREQ_MAP[k]}
            onClick={() =>
              set("frequency")(
                data.frequency === FREQ_MAP[k] ? "" : FREQ_MAP[k],
              )
            }
          />
        ))}
      </div>
      <Label>Repeats</Label>
      <SearchDropdown
        placeholder="Search repeats..."
        options={REPEAT_OPTIONS}
        value={data.repeats}
        onChange={set("repeats")}
      />
      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
        {QUICK_REPEAT.map((k) => (
          <QuickButton
            key={k}
            label={k}
            active={data.repeats === REPEAT_MAP[k]}
            onClick={() =>
              set("repeats")(
                data.repeats === REPEAT_MAP[k] ? "" : REPEAT_MAP[k],
              )
            }
          />
        ))}
      </div>
      <Label>Duration</Label>
      <SearchDropdown
        placeholder="Search duration..."
        options={DURATION_OPTIONS}
        value={data.duration}
        onChange={set("duration")}
      />
    </div>
  );
}

function Label({ children }) {
  return (
    <div
      style={{
        marginTop: 10,
        marginBottom: 4,
        fontSize: 11,
        color: "#6b7280",
        fontWeight: 500,
      }}
    >
      {children}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const empty = () => ({
    drug: "",
    eye: "",
    frequency: "",
    repeats: "",
    duration: "",
  });
  const [drugs, setDrugs] = useState([empty(), empty(), empty()]);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [processed, setProcessed] = useState("");
  const [highlights, setHighlights] = useState([false, false, false]);
  const [sttOk, setSttOk] = useState(true);
  const [interim, setInterim] = useState("");
  const recogRef = useRef(null);

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window))
      setSttOk(false);
  }, []);

  const updateDrug = useCallback((idx, field, val) => {
    setDrugs((prev) =>
      prev.map((d, i) => (i === idx ? { ...d, [field]: val } : d)),
    );
  }, []);

  const applyRx = useCallback((rxs) => {
    if (!rxs.length) return;
    const nd = [empty(), empty(), empty()],
      nh = [false, false, false];
    rxs.slice(0, 3).forEach((p, i) => {
      nd[i] = {
        drug: p.drug || "",
        eye: p.eye || "",
        frequency: p.frequency || "",
        repeats: p.repeats || "",
        duration: p.duration || "",
      };
      nh[i] = true;
    });
    setDrugs(nd);
    setHighlights(nh);
    setTimeout(() => setHighlights([false, false, false]), 1000);
  }, []);

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-AU";
    r.maxAlternatives = 3;
    r.onstart = () => setListening(true);
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    r.onerror = () => {
      setListening(false);
      setInterim("");
    };
    r.onresult = (e) => {
      let fin = "",
        tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++)
        e.results[i].isFinal
          ? (fin += e.results[i][0].transcript + " ")
          : (tmp += e.results[i][0].transcript);
      if (tmp) setInterim(tmp);
      if (fin.trim()) {
        setInterim("");
        setTranscript((prev) => {
          const updated = (prev + " " + fin).trim();
          const proc = applyCustomDictionary(updated);
          setProcessed(proc);
          const rxs = parseTranscript(proc);
          if (rxs.length) applyRx(rxs);
          return proc;
        });
      }
    };
    recogRef.current = r;
    r.start();
  };

  const stopListening = () => {
    recogRef.current?.stop();
    setListening(false);
  };

  const clearAll = () => {
    setDrugs([empty(), empty(), empty()]);
    setTranscript("");
    setProcessed("");
    setInterim("");
  };

  const parseManual = () => {
    if (!transcript.trim()) return;
    const p = applyCustomDictionary(transcript);
    setTranscript(p);
    setProcessed(p);
    const rxs = parseTranscript(p);
    if (rxs.length) applyRx(rxs);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        fontFamily: "'DM Sans','Segoe UI',sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes flashCol{0%{background:#eff6ff}100%{background:transparent}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>
        {/* Voice panel */}
        <div
          style={{
            background: "#fff",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            padding: 20,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
              🎙 Voice Transcription
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {!sttOk && (
                <span
                  style={{
                    fontSize: 11,
                    color: "#ef4444",
                    background: "#fef2f2",
                    padding: "3px 8px",
                    borderRadius: 4,
                  }}
                >
                  STT not supported
                </span>
              )}
              <button
                onClick={clearAll}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  color: "#64748b",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Clear All
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {sttOk && (
              <button
                onClick={listening ? stopListening : startListening}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                  background: listening ? "#ef4444" : "#3b82f6",
                  color: "#fff",
                  boxShadow: listening
                    ? "0 0 0 4px rgba(239,68,68,0.2)"
                    : "0 2px 8px rgba(59,130,246,0.3)",
                  transition: "all 0.2s",
                }}
              >
                <span
                  style={{
                    animation: listening ? "pulse 1.2s infinite" : "none",
                    fontSize: 16,
                  }}
                >
                  {listening ? "⏹" : "🎤"}
                </span>
                {listening ? "Stop Recording" : "Start Recording"}
              </button>
            )}
            <button
              onClick={parseManual}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "1px solid #3b82f6",
                background: "#eff6ff",
                color: "#3b82f6",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              ⚡ Parse Text
            </button>
          </div>

          <div style={{ position: "relative" }}>
            <textarea
              value={transcript + (interim ? " " + interim : "")}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={`Speak or type here…\nExample: "Xalacom right eye bd no repeats for 4 weeks"`}
              style={{
                width: "100%",
                minHeight: 90,
                border: "1px solid",
                borderColor: listening ? "#10b981" : "#e2e8f0",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                color: "#1e293b",
                resize: "vertical",
                fontFamily: "inherit",
                outline: "none",
                lineHeight: 1.6,
                background: listening ? "#fafffe" : "#f8fafc",
              }}
            />
            {listening && (
              <div
                style={{
                  position: "absolute",
                  top: 10,
                  right: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#ef4444",
                    animation: "pulse 1s infinite",
                    display: "inline-block",
                  }}
                />
                <span
                  style={{ fontSize: 11, color: "#ef4444", fontWeight: 600 }}
                >
                  LIVE
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Prescription form */}
        <div
          style={{
            background: "#fff",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
              marginBottom: 16,
            }}
          >
            📋 Prescription
          </div>
          <div style={{ display: "flex" }}>
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                style={{
                  flex: 1,
                  borderRight: idx < 2 ? "1px solid #f1f5f9" : "none",
                  paddingRight: idx < 2 ? 16 : 0,
                  paddingLeft: idx > 0 ? 16 : 0,
                }}
              >
                <DrugColumn
                  idx={idx}
                  data={drugs[idx]}
                  onChange={updateDrug}
                  highlight={highlights[idx]}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
