// Vercel Serverless Function — OpenAI 버전 (텍스트 + URL 분석 지원)
// Vercel 환경변수: OPENAI_API_KEY = sk-...

// HTML에서 본문 텍스트만 추출
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// 내부망 주소 등 위험한 URL 차단
function isBlockedUrl(u) {
  try {
    const { protocol, hostname } = new URL(u);
    if (protocol !== "http:" && protocol !== "https:") return true;
    return (
      hostname === "localhost" ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname)
    );
  } catch {
    return true;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 허용됩니다." });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "서버에 OPENAI_API_KEY 환경변수가 설정되지 않았습니다." });
  }

  let { text, url } = req.body || {};
  let extractedText = null;

  // ── URL 모드: 기사를 서버에서 가져와 본문 추출 ──
  if (url) {
    if (isBlockedUrl(url)) {
      return res.status(400).json({ error: "허용되지 않는 URL입니다." });
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000); // 10초 제한
      const page = await fetch(url, {
        signal: controller.signal,
        headers: {
          // 일부 언론사는 브라우저가 아닌 요청을 차단하므로 UA 지정
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
          "Accept-Language": "ko-KR,ko;q=0.9",
        },
      });
      clearTimeout(timer);

      if (!page.ok) {
        return res.status(400).json({ error: `기사 페이지 응답 오류 (${page.status}) — 로그인이 필요하거나 접근이 차단된 사이트일 수 있습니다.` });
      }
      const html = await page.text();
      extractedText = extractText(html);

      if (extractedText.length < 100) {
        return res.status(400).json({ error: "본문 추출 실패 — 이 사이트는 자동 수집이 어렵습니다. 본문을 직접 복사해 붙여넣어 주세요." });
      }
      text = extractedText;
    } catch (e) {
      const msg = e.name === "AbortError" ? "기사 페이지 응답 시간 초과 (10초)" : `기사 페이지 접속 실패: ${e.message}`;
      return res.status(400).json({ error: msg });
    }
  }

  if (!text || typeof text !== "string" || text.trim().length < 20) {
    return res.status(400).json({ error: "분석할 텍스트가 너무 짧습니다. (20자 이상)" });
  }

  const prompt = `다음 텍스트의 정보 신뢰성을 분석하라. 순수 JSON만 출력하라. 백틱, 설명문 금지. 모든 comment와 reason은 15자 내외로 아주 짧게 쓰라.

{"score":0~100 정수,"grade":"신뢰"|"주의"|"위험","summary":"1문장 총평","criteria":[{"name":"출처 신뢰성","score":정수,"comment":"짧게"},{"name":"사실 검증 가능성","score":정수,"comment":"짧게"},{"name":"감정적 표현","score":정수,"comment":"짧게"},{"name":"논리 구조","score":정수,"comment":"짧게"},{"name":"편향성","score":정수,"comment":"짧게"}],"flags":[{"quote":"문제 문장 일부(15자 이내)","reason":"짧게"}] 최대 2개, 없으면 []}

분석 대상:
"""
${text.slice(0, 2500)}
"""`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // 품질 높이려면 "gpt-4o" 등으로 교체
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(502).json({ error: `OpenAI API 오류: ${data.error.message}`, extractedText });
    }

    const raw = data.choices?.[0]?.message?.content || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(502).json({ error: "AI 응답에서 JSON을 찾지 못했습니다.", extractedText });
    }

    try {
      const result = JSON.parse(match[0]);
      if (extractedText) result.extractedText = extractedText.slice(0, 5000);
      return res.status(200).json(result);
    } catch {
      return res.status(502).json({ error: "AI 응답 JSON 파싱 실패", extractedText });
    }
  } catch (e) {
    return res.status(500).json({ error: `서버 오류: ${e.message}`, extractedText });
  }
}
