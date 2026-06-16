export default async function handler(req, res) {
  // Защита от случайных вызовов извне
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const TOPIC = "интересные принты на одежде"; // тема блога

  try {
    // 1. Запрос к Claude API с веб-поиском — просим вернуть структурированный JSON
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{
          role: "user",
          content: `Найди 5-6 интересных, необычных или вирусных принтов на одежде, которые сейчас обсуждают (авангардные, винтажные, масс-маркетные — любые, главное чтобы были визуально интересными и подходили для блога про моду). Это может быть как недавняя новость, так и просто яркий пример принта, который стоит показать.

Для каждого пункта найди:
- название/описание принта
- бренд или дизайнер (если известен)
- короткую историю создания или вдохновения (если есть информация)
- прямую ссылку на изображение этого принта/одежды (настоящую ссылку на картинку из результатов поиска, не выдумывай)
- ссылку на источник/статью

Ответь СТРОГО в формате JSON, без какого-либо текста до или после, без markdown-разметки, в следующей структуре:
{
  "items": [
    {
      "title": "Название принта",
      "brand": "Бренд/дизайнер",
      "description": "Короткое описание принта",
      "story": "История создания или вдохновения",
      "image_url": "https://...",
      "source_url": "https://...",
      "source_name": "Название источника"
    }
  ]
}`
        }],
        tools: [{ type: "web_search_20250305", name: "web_search" }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} ${errText}`);
    }

    const data = await claudeRes.json();
    const rawText = data.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n");

    // Извлекаем JSON из ответа (на случай если модель добавит лишний текст)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { items: [] };
    const items = parsed.items || [];

    // 2. Собираем красивое HTML-письмо с картинками
    const itemsHtml = items.map(item => `
      <div style="margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #eee;">
        <h2 style="font-size: 20px; margin-bottom: 8px; color: #1a1a1a;">${item.title || ''}</h2>
        ${item.brand ? `<p style="color: #888; margin: 4px 0; font-size: 14px;"><strong>Бренд/дизайнер:</strong> ${item.brand}</p>` : ''}
        ${item.image_url ? `<img src="${item.image_url}" alt="${item.title || ''}" style="max-width: 100%; border-radius: 8px; margin: 12px 0;" />` : ''}
        ${item.description ? `<p style="line-height: 1.6; color: #333;">${item.description}</p>` : ''}
        ${item.story ? `<p style="line-height: 1.6; color: #555; font-style: italic; margin-top: 8px;"><strong>История:</strong> ${item.story}</p>` : ''}
        ${item.source_url ? `<p style="margin-top: 8px;"><a href="${item.source_url}" style="color: #2563eb; font-size: 13px;">Источник: ${item.source_name || item.source_url}</a></p>` : ''}
      </div>
    `).join('');

    const htmlBody = `
      <div style="font-family: -apple-system, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="font-size: 24px; margin-bottom: 24px;">🎨 Дайджест принтов — ${new Date().toLocaleDateString('ru-RU')}</h1>
        ${itemsHtml || '<p>Сегодня не удалось найти подходящие материалы.</p>'}
      </div>
    `;

    // 3. Отправка письма через Resend
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to: process.env.REPORT_EMAIL,
        subject: `Дайджест принтов — ${new Date().toLocaleDateString('ru-RU')}`,
        html: htmlBody
      })
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Resend API error: ${emailRes.status} ${errText}`);
    }

    return res.status(200).json({ success: true, items });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
