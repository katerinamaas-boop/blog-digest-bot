export default async function handler(req, res) {
  // Защита от случайных вызовов извне
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const TOPIC = "красота, стиль и мода"; // тема блога

  try {
    // 1. Запрос к Claude API с веб-поиском
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `Найди свежие новости и тренды за последние 24-48 часов по теме "${TOPIC}". Дай дайджест из 5-7 пунктов: новые коллекции, тренды сезона, интересные события в индустрии, всё, что может быть полезно для блога на эту тему. Для каждого пункта дай короткое описание и источник.`
        }],
        tools: [{ type: "web_search_20250305", name: "web_search" }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} ${errText}`);
    }

    const data = await claudeRes.json();
    const report = data.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n\n");

    // 2. Отправка письма через Resend
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to: process.env.REPORT_EMAIL,
        subject: `Дайджест для блога — ${new Date().toLocaleDateString('ru-RU')}`,
        text: report
      })
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Resend API error: ${emailRes.status} ${errText}`);
    }

    return res.status(200).json({ success: true, report });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
