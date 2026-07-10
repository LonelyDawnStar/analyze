// Vercel Serverless Function — OpenAI 버전
// Vercel 대시보드 → Settings → Environment Variables 에서
//   OPENAI_API_KEY = sk-... 를 등록해야 작동한다.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 허용됩니다." });
  }

  const { text } = req.body || {};
  if (!text || typeof text !== "string" || text.trim().length < 20) {
    return res.status(400).json({ error: "분석할 텍스트가 너무 짧습니다. (20자 이상)" });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "서버에 OPENAI_API_KEY 환경변수가 설정되지 않았습니다." });
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
        // OpenAI는 Authorization: Bearer 방식 (Anthropic의 x-api-key와 다름)
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // 저렴한 모델. 품질 높이려면 "gpt-4o" 등으로 교체
        max_tokens: 1024,
        response_format: { type: "json_object" }, // JSON 강제 출력
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(502).json({ error: `OpenAI API 오류: ${data.error.message}` });
    }

    const raw = data.choices?.[0]?.message?.content || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(502).json({ error: "AI 응답에서 JSON을 찾지 못했습니다." });
    }

    try {
      return res.status(200).json(JSON.parse(match[0]));
    } catch {
      return res.status(502).json({ error: "AI 응답 JSON 파싱 실패" });
    }
  } catch (e) {
    return res.status(500).json({ error: `서버 오류: ${e.message}` });
  }
}
