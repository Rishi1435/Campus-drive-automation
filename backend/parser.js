const { OpenAI } = require('openai');
require('dotenv').config();

// Reuse one client per API key (the user's own key, or the shared env fallback).
const clients = new Map();
function clientFor(apiKey) {
  const key = apiKey || process.env.NVIDIA_API_KEY || 'dummy_key';
  if (!clients.has(key)) {
    clients.set(key, new OpenAI({ baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: key }));
  }
  return clients.get(key);
}

async function parseDriveData(text, base64Image, apiKey) {
  try {
    const openai = clientFor(apiKey);
    const systemMessage = {
      role: 'system',
      content: 'You are an assistant that extracts structured data from campus placement drives and hiring messages. Extract the details and output strictly a JSON object with the following keys: company, role, ctc, eligibility, deadline, and applyLink. If a detail is missing, set its value to null. Output only the JSON object without any markdown formatting, backticks, or additional text.'
    };

    let userContent = [
      { type: 'text', text: `Here is the message containing the drive info:\n\n${text}` }
    ];

    if (base64Image) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${base64Image}` }
      });
    }

    const messages = [
      systemMessage,
      { role: 'user', content: userContent }
    ];

    const response = await openai.chat.completions.create({
      model: 'meta/llama-3.2-90b-vision-instruct',
      messages: messages,
      temperature: 0.6,
      top_p: 0.95,
      max_tokens: 4096,
    });

    const outputText = response.choices[0].message.content.trim();

    // Parse the expected JSON
    try {
      let cleanText = outputText;
      if (cleanText.includes('```')) {
        const match = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) {
          cleanText = match[1].trim();
        }
      }
      const firstBrace = cleanText.indexOf('{');
      const lastBrace = cleanText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
      }

      const jsonData = JSON.parse(cleanText);
      return jsonData;
    } catch (parseError) {
      console.error('Error parsing JSON from LLM response:', parseError);
      console.log('Raw output:', outputText);
      return null;
    }

  } catch (error) {
    console.error('Error during LLM API call:', error);
    return null;
  }
}

module.exports = { parseDriveData };
